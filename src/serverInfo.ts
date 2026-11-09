// 伺服器啟動後的連線資訊，供「手機連線」頁面顯示。
export interface ServerInfo {
  version: string;
  httpPort: number;
  httpsPort: number;
  localUrl: string;
  lanHttpsUrl: string | null;
  lanHttpUrl: string | null;
  lanIps: string[];
}

let info: ServerInfo = {
  version: "",
  httpPort: 0,
  httpsPort: 0,
  localUrl: "",
  lanHttpsUrl: null,
  lanHttpUrl: null,
  lanIps: [],
};

export function setServerInfo(v: ServerInfo): void {
  info = v;
}

export function getServerInfo(): ServerInfo {
  return info;
}
