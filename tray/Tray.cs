// 圖書借閱系統：右下角工具列圖示。
//
// 由伺服器（圖書借閱系統.exe）啟動，兩邊用標準輸入／輸出一行一行溝通（UTF-8）：
//   伺服器 → 圖示：tip <文字>                 更新滑鼠停留時的說明
//                  balloon <標題>\t<內文>      顯示通知
//                  exit                       移除圖示並結束
//   圖示 → 伺服器：ready / open / phone / folder / quit
// 伺服器結束時標準輸入會關閉，圖示也跟著結束，不會留下沒有作用的圖示。
//
// 另一個用法：school-library-tray.exe --error <標題> <內文>   顯示錯誤對話框（伺服器啟動失敗時用）
//
// 以 Windows 內建的 .NET Framework 4 C# 編譯器（csc.exe）編譯，所以只用 C# 5 語法。
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("圖書借閱系統（工具列圖示）")]
[assembly: AssemblyDescription("圖書借閱系統（工具列圖示）")]
[assembly: AssemblyProduct("幼兒園圖書借閱系統")]

static class Program
{
    const string AppName = "圖書借閱系統";

    static NotifyIcon icon;
    static TextWriter output;
    static SynchronizationContext ui;
    static bool exiting;

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (args.Length >= 3 && args[0] == "--error")
        {
            MessageBox.Show(args[2], args[1], MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 0;
        }

        output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        ((StreamWriter)output).AutoFlush = true;

        ui = new WindowsFormsSynchronizationContext();
        SynchronizationContext.SetSynchronizationContext(ui);

        icon = new NotifyIcon();
        icon.Icon = LoadIcon();
        icon.Text = AppName;
        icon.ContextMenuStrip = BuildMenu();
        icon.MouseClick += delegate(object s, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) Send("open");
        };
        icon.Visible = true;

        Thread reader = new Thread(ReadCommands);
        reader.IsBackground = true;
        reader.Start();

        // 登出或關機時，請伺服器正常關閉
        Microsoft.Win32.SystemEvents.SessionEnding += delegate { Send("quit"); };

        Send("ready");
        Application.Run();
        return 0;
    }

    static Icon LoadIcon()
    {
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("AppIcon.ico");
        if (s != null)
        {
            using (s) return new Icon(s, SystemInformation.SmallIconSize);
        }
        return SystemIcons.Application;
    }

    static ContextMenuStrip BuildMenu()
    {
        ContextMenuStrip menu = new ContextMenuStrip();

        ToolStripMenuItem open = new ToolStripMenuItem("開啟圖書借閱系統");
        open.Font = new Font(open.Font, FontStyle.Bold);
        open.Click += delegate { Send("open"); };
        menu.Items.Add(open);

        ToolStripMenuItem phone = new ToolStripMenuItem("手機／平板連線");
        phone.Click += delegate { Send("phone"); };
        menu.Items.Add(phone);

        ToolStripMenuItem folder = new ToolStripMenuItem("開啟程式資料夾");
        folder.Click += delegate { Send("folder"); };
        menu.Items.Add(folder);

        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem quit = new ToolStripMenuItem("結束服務");
        quit.Click += delegate
        {
            DialogResult r = MessageBox.Show(
                "確定要結束圖書借閱系統嗎？\n\n結束後，這台電腦和手機、平板都無法借還書，\n要再使用時請重新開啟「圖書借閱系統.exe」。",
                AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (r == DialogResult.Yes)
            {
                icon.Text = AppName + "：正在結束…";
                Send("quit");
            }
        };
        menu.Items.Add(quit);

        return menu;
    }

    static void Send(string line)
    {
        try { output.WriteLine(line); }
        catch { ui.Post(delegate { Exit(); }, null); }  // 伺服器已經不在了
    }

    static void ReadCommands()
    {
        StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        try
        {
            string line;
            while ((line = input.ReadLine()) != null)
            {
                string cmd = line;
                ui.Post(delegate { Handle(cmd); }, null);
            }
        }
        catch { }
        // 伺服器結束（標準輸入關閉）
        ui.Post(delegate { Exit(); }, null);
    }

    static void Handle(string line)
    {
        int sp = line.IndexOf(' ');
        string cmd = sp < 0 ? line : line.Substring(0, sp);
        string arg = sp < 0 ? "" : line.Substring(sp + 1);
        if (cmd == "tip")
        {
            // .NET Framework 的 NotifyIcon.Text 最多 63 個字元
            icon.Text = arg.Length > 63 ? arg.Substring(0, 63) : arg;
        }
        else if (cmd == "balloon")
        {
            int tab = arg.IndexOf('\t');
            string title = tab < 0 ? AppName : arg.Substring(0, tab);
            string text = tab < 0 ? arg : arg.Substring(tab + 1);
            if (text.Length == 0) text = " ";
            icon.ShowBalloonTip(5000, title, text.Replace("\\n", "\n"), ToolTipIcon.Info);
        }
        else if (cmd == "exit")
        {
            Exit();
        }
    }

    static void Exit()
    {
        if (exiting) return;
        exiting = true;
        if (icon != null)
        {
            icon.Visible = false;  // 先隱藏，避免工具列留下殘影
            icon.Dispose();
        }
        Application.Exit();
    }
}
