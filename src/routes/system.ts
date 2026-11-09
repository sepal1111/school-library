// 系統：備份與還原、連線資訊（手機連線用 QR Code）。
import fs from "fs";
import multer from "multer";
import path from "path";
import QRCode from "qrcode";
import { Router } from "express";
import { requireAdmin } from "../auth";
import { createBackup, isBackupName, listBackups, restoreFromZip } from "../backup";
import { bad, h, notFound } from "../http";
import { getBackupsDir, getTmpDir } from "../paths";
import { getServerInfo } from "../serverInfo";

const router = Router();
const upload = multer({ dest: getTmpDir(), limits: { fileSize: 500 * 1024 * 1024 } });

router.get(
  "/system/info",
  h(async (_req, res) => {
    const info = getServerInfo();
    const qr = info.lanHttpsUrl ? await QRCode.toDataURL(info.lanHttpsUrl, { margin: 1, width: 280 }) : null;
    res.json({ ...info, qr });
  })
);

/** 下載自簽憑證檔案（供手機/平板安裝為受信任根憑證） */
export const sendCertHandler = h((_req, res) => {
  const certPath = path.join(path.dirname(getBackupsDir()), "certs", "server.crt");
  if (!fs.existsSync(certPath)) throw notFound("找不到憑證檔案");
  res.setHeader("Content-Type", "application/x-x509-ca-cert");
  res.setHeader("Content-Disposition", 'attachment; filename="school-library.crt"');
  res.sendFile(certPath);
});

router.get("/system/cert", sendCertHandler);

router.get(
  "/backups",
  requireAdmin,
  h((_req, res) => {
    res.json(listBackups());
  })
);

router.post(
  "/backups",
  requireAdmin,
  h((_req, res) => {
    res.json({ name: createBackup("manual") });
  })
);

router.get(
  "/backups/:name",
  requireAdmin,
  h((req, res) => {
    const name = String(req.params.name);
    if (!isBackupName(name)) throw bad("檔名不正確");
    const file = path.join(getBackupsDir(), name);
    if (!fs.existsSync(file)) throw notFound("找不到備份檔");
    res.download(file, name);
  })
);

router.post(
  "/restore",
  requireAdmin,
  upload.single("file"),
  h((req, res) => {
    const file = req.file;
    if (!file) throw bad("請選擇備份檔");
    try {
      restoreFromZip(file.path);
    } finally {
      fs.rmSync(file.path, { force: true });
    }
    res.json({ ok: true });
  })
);

export default router;
