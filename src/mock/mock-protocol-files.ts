/**
 * Demo-mode file transfer off the flight controller: the dataflash log list
 * and LOG_DATA download, and an in-memory MAVLink FTP store so the Scripts tab
 * round-trips (upload, list, remove).
 *
 * @license GPL-3.0-only
 */

import type {
  FtpDirEntry,
  FtpDownloadProgressCallback,
  LogDownloadProgressCallback,
  LogEntry,
} from "@/lib/protocol/types";
import { getMockLogList } from "./mock-protocol-data";

/** MAVLink FTP burst payload size, the chunk progress is reported in. */
const FTP_CHUNK = 239;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export class MockFcFiles {
  /** Path → size of the files on the FC's SD card. */
  private ftpFiles = new Map<string, number>([
    ["APM/scripts/rangefinder_test.lua", 1420],
    ["APM/scripts/hello_world.lua", 210],
  ]);

  async getLogList(): Promise<LogEntry[]> {
    return getMockLogList();
  }

  async downloadLog(_id: number, onProgress?: LogDownloadProgressCallback): Promise<Uint8Array> {
    const total = 4096, chunk = 90;
    for (let i = 0; i < Math.ceil(total / chunk); i++) {
      await delay(100);
      if (onProgress) onProgress(Math.min((i + 1) * chunk, total), total);
    }
    const data = new Uint8Array(total); data[0] = 0xa3; data[1] = 0x95; return data;
  }

  async downloadFileViaFtp(_path: string, onProgress?: FtpDownloadProgressCallback): Promise<Uint8Array> {
    const total = 2048;
    const data = new Uint8Array(total);
    for (let i = 0; i < total; i++) data[i] = i & 0xff;
    for (let ofs = 0; ofs < total; ofs += FTP_CHUNK) {
      await delay(60);
      if (onProgress) onProgress(Math.min(ofs + FTP_CHUNK, total), total);
    }
    return data;
  }

  async uploadFileViaFtp(path: string, bytes: Uint8Array, onProgress?: (written: number, total: number) => void): Promise<void> {
    const total = bytes.length;
    for (let ofs = 0; ofs <= total; ofs += FTP_CHUNK) {
      await delay(40);
      if (onProgress) onProgress(Math.min(ofs + FTP_CHUNK, total), total);
    }
    this.ftpFiles.set(path, total);
  }

  async listDirectoryViaFtp(path: string): Promise<FtpDirEntry[]> {
    await delay(120);
    const prefix = path.endsWith("/") ? path : path + "/";
    return [...this.ftpFiles.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, size]) => ({ name: p.slice(prefix.length), size, isDir: false }));
  }

  async removeFileViaFtp(path: string): Promise<void> {
    await delay(80);
    this.ftpFiles.delete(path);
  }
}
