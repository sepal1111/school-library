import os from "os";

/**
 * 取得本機所有非內部的 IPv4 位址。
 * 優先排序電腦的實體區域網路 IP（例如學校/機構真實區網 163.x.x.x、常見私人 IP 192.168.x.x、10.x.x.x、172.16-31.x.x）。
 * 排除並降序虛擬網卡（Tailscale 100.64.0.0/10、vEthernet、VirtualBox、VMware、WSL、Hyper-V、ZeroTier 等）。
 */
export function getLanIps(): string[] {
  const nets = os.networkInterfaces();
  const realPhysical: string[] = [];
  const privateLan: string[] = [];
  const virtualIps: string[] = [];

  for (const [name, list] of Object.entries(nets)) {
    for (const net of list ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const ip = net.address;

      // 判斷是否為虛擬或 VPN 介面
      const isVirtualName = /Tailscale|ZeroTier|vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|docker|tun|tap|vpn/i.test(name);
      // 100.64.0.0/10 為電信級 NAT / Tailscale CGNAT
      const isCgnat = /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(ip);
      const isLinkLocal = ip.startsWith("169.254.");

      if (isVirtualName || isCgnat || isLinkLocal) {
        virtualIps.push(ip);
        continue;
      }

      // 常見私有區網 IP
      const isPrivate =
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);

      if (isPrivate) {
        privateLan.push(ip);
      } else {
        // 真實校園網/實體公網 IP（例如 163.19.x.x）
        realPhysical.push(ip);
      }
    }
  }

  // 排序優先度：真實實體網卡 IP（例如學校配發的公有 IP） > 私人區域網路 IP > 虛擬/Tailscale IP
  return [...realPhysical, ...privateLan, ...virtualIps];
}

export function getPrimaryLanIp(): string {
  return getLanIps()[0] ?? "127.0.0.1";
}
