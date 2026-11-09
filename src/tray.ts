// 右下角工具列圖示（只有打包成 exe 的 Windows 可攜版使用）。
// 圖示是另一個小程式 system/school-library-tray.exe（原始碼 tray/Tray.cs），
// 由這裡啟動，兩邊用標準輸入／輸出一行一行溝通；伺服器結束時圖示會自動消失。
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { getAppDir, isPackaged } from "./paths";

export type TrayEvent = "open" | "phone" | "folder" | "quit";

const TRAY_EXE = "school-library-tray.exe";
const MAX_RESTARTS = 3;

function trayExePath(): string {
  return path.join(getAppDir(), "system", TRAY_EXE);
}

/** 打包後的 Windows exe，而且 tray 程式存在，才使用工具列圖示。SCHOOL_LIB_NO_TRAY=1 可以關閉（測試用）。 */
export function isTrayAvailable(): boolean {
  return (
    isPackaged() && process.platform === "win32" && !process.env.SCHOOL_LIB_NO_TRAY && fs.existsSync(trayExePath())
  );
}

/** 顯示錯誤對話框（啟動失敗時用）。不等使用者按確定，伺服器可以先結束。 */
export function showErrorDialog(title: string, message: string): void {
  if (process.platform !== "win32" || !fs.existsSync(trayExePath())) return;
  const p = spawn(trayExePath(), ["--error", title, message], { detached: true, stdio: "ignore", windowsHide: true });
  p.unref();
}

export class Tray {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private restarts = 0;
  private tip = "";

  constructor(private readonly onEvent: (e: TrayEvent) => void) {}

  start(): void {
    const proc = spawn(trayExePath(), [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc = proc;
    proc.stdin.on("error", () => undefined); // 圖示程式已結束時寫入會失敗，忽略
    readline.createInterface({ input: proc.stdout }).on("line", (raw) => {
      const line = raw.trim();
      if (line === "ready") {
        if (this.tip) this.send(`tip ${this.tip}`);
        return;
      }
      if (line === "open" || line === "phone" || line === "folder" || line === "quit") this.onEvent(line);
    });
    proc.on("error", (err) => console.warn("工具列圖示無法啟動：", err.message));
    proc.on("exit", (code) => {
      if (this.proc === proc) this.proc = null;
      if (this.stopping) return;
      // 圖示意外消失時重新啟動，不然使用者沒辦法開啟或結束系統
      if (this.restarts < MAX_RESTARTS) {
        this.restarts++;
        console.warn(`工具列圖示意外結束（${code}），重新啟動（第 ${this.restarts} 次）`);
        setTimeout(() => this.start(), 1000);
      } else {
        console.error("工具列圖示多次意外結束，不再重新啟動");
      }
    });
  }

  private send(line: string): void {
    if (this.proc && !this.proc.stdin.destroyed) this.proc.stdin.write(`${line.replace(/[\r\n]+/g, " ")}\n`);
  }

  setTooltip(text: string): void {
    this.tip = text;
    this.send(`tip ${text}`);
  }

  /** 右下角跳出通知。內文可以用 \n 換行。 */
  notify(title: string, text: string): void {
    this.send(`balloon ${title}\t${text.replace(/\n/g, "\\n")}`);
  }

  stop(): void {
    this.stopping = true;
    this.send("exit");
  }
}
