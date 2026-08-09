export type InstalledDriver = {
  name: string;
  driverClass: string;
  jarPaths: string[];
  installedAt: number;
};

export async function getJdbcStorageDir(subDir?: string): Promise<string> {
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    const { appDataDir } = await import("@tauri-apps/api/path");
    const appDir = await appDataDir();
    return subDir ? `${appDir}/jdbc-drivers/${subDir}` : `${appDir}/jdbc-drivers`;
  }
  return subDir ? `jdbc-drivers/${subDir}` : "jdbc-drivers";
}

export async function loadInstalledDrivers(): Promise<InstalledDriver[]> {
  try {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("load_jdbc_drivers");
    } else {
      const stored = localStorage.getItem("jdbc-installed-drivers");
      return stored ? JSON.parse(stored) : [];
    }
  } catch {
    return [];
  }
}

export async function isDriverInstalled(name: string): Promise<boolean> {
  const installed = await loadInstalledDrivers();
  return installed.some((i) => i.name === name);
}

export async function saveInstalledDriver(
  name: string,
  driverClass: string,
  jarPaths: string[],
): Promise<void> {
  const installed = await loadInstalledDrivers();
  const existing = installed.findIndex((i) => i.name === name);
  const entry: InstalledDriver = { name, driverClass, jarPaths, installedAt: Date.now() };
  if (existing >= 0) {
    installed[existing] = entry;
  } else {
    installed.push(entry);
  }
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_jdbc_driver_manifest", { name, driverClass, jarPaths });
  } else {
    localStorage.setItem("jdbc-installed-drivers", JSON.stringify(installed));
  }
}

export async function removeInstalledDriver(name: string): Promise<void> {
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("remove_jdbc_driver", { name });
  } else {
    const installed = await loadInstalledDrivers();
    const filtered = installed.filter((i) => i.name !== name);
    localStorage.setItem("jdbc-installed-drivers", JSON.stringify(filtered));
  }
}
