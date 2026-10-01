import type { BbDesktopInfo } from "@bb/desktop-contract";

type Updater = {
  autoDownload: boolean; autoInstallOnAppQuit: boolean; allowPrerelease: boolean; allowDowngrade: boolean;
  on(event: string, listener: (update: { version: string }) => void): unknown;
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(silent: boolean, forceRunAfter: boolean): void;
};
export function createUpdateService({ updater, version, enabled, changed, log }: {
  updater: Updater; version: string; enabled: boolean;
  changed: (info: BbDesktopInfo) => void; log: (message: string) => void;
}) {
  let info: BbDesktopInfo = { platform: "windows", version, lastCheckedAt: null, latestVersion: null, pendingVersion: null, updateAvailable: false, updateDownloaded: false, downloadState: "idle", serverDaemonLogsAvailable: false };
  let pending: Promise<BbDesktopInfo> | null = null;
  let stopped = false;
  let installing = false;
  const publish = (patch: Partial<BbDesktopInfo>) => { if (!stopped) { info = { ...info, ...patch }; changed({ ...info }); } };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on("update-available", update => publish({ latestVersion: update.version, updateAvailable: true, downloadState: "downloading" }));
  updater.on("update-not-available", update => publish({ latestVersion: update.version, updateAvailable: false, downloadState: "idle" }));
  updater.on("update-downloaded", update => publish({ latestVersion: update.version, pendingVersion: update.version, updateAvailable: true, updateDownloaded: true, downloadState: "downloaded" }));
  updater.on("error", () => { installing = false; log("Update check or download failed; keeping the current application."); publish({ downloadState: info.updateDownloaded ? "downloaded" : "failed" }); });
  const check = (): Promise<BbDesktopInfo> => {
    if (stopped || !enabled || info.updateDownloaded) return Promise.resolve({ ...info });
    if (pending) return pending;
    publish({ lastCheckedAt: new Date().toISOString() });
    pending = (async () => {
      try {
        const result = await updater.checkForUpdates();
        if (result?.downloadPromise) void result.downloadPromise.catch(() => {});
      } catch { publish({ downloadState: info.updateDownloaded ? "downloaded" : "failed" }); }
      return { ...info };
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    getInfo: () => ({ ...info }), check,
    install() {
      if (stopped || !enabled || !info.updateDownloaded || installing) return false;
      installing = true;
      updater.quitAndInstall(true, true);
      return true;
    },
    stop() { stopped = true; },
  };
}
