// 區域網路用的自簽 HTTPS 憑證。手機瀏覽器只在 HTTPS（或 localhost）下允許使用相機，
// 所以手機掃描條碼必須走 HTTPS。憑證存在 bin/certs/，只有在過期或 IP 改變時才重新產生，
// 避免每次啟動都要讓每台手機重新點過一次憑證警告。
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { generate as generateSelfSigned } from "selfsigned";
import { getCertsDir } from "./paths";
import { getLanIps } from "./utils/network";

const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

function stillValid(certPem: string, targets: string[]): boolean {
  try {
    const x509 = new crypto.X509Certificate(certPem);
    const expires = new Date(x509.validTo).getTime();
    if (Number.isNaN(expires) || expires - Date.now() < 30 * 86400000) return false;
    const san = x509.subjectAltName ?? "";
    return targets.every((t) => san.includes(isIp(t) ? `IP Address:${t}` : `DNS:${t}`));
  } catch {
    return false;
  }
}

export async function getHttpsOptions(): Promise<{ key: Buffer; cert: Buffer }> {
  const dir = getCertsDir();
  const certPath = path.join(dir, "server.crt");
  const keyPath = path.join(dir, "server.key");
  const targets = [...new Set([...getLanIps(), "127.0.0.1", "localhost"])];

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    if (stillValid(fs.readFileSync(certPath, "utf-8"), targets)) {
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    }
  }

  const altNames = targets.map((t) => (isIp(t) ? { type: 7 as const, ip: t } : { type: 2 as const, value: t }));
  const pems = await generateSelfSigned([{ name: "commonName", value: "School Library CA" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 3650 * 86400000),
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: true, cRLSign: true },
      { name: "subjectAltName", altNames },
    ],
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert) };
}
