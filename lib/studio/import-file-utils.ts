export interface ImportFileOptions<T> {
  acceptedType: string;
  label: string;
  onImport: (data: T) => void;
}

export function triggerImportFileClick(ref: React.RefObject<HTMLInputElement | null>) {
  ref.current?.click();
}

export function createImportFileHandler<T extends { version: number; type: string }>(
  options: ImportFileOptions<T>,
) {
  return (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(
          event.target?.result as string,
        ) as T;
        if (
          typeof data.version !== "number" ||
          data.version < 1 ||
          data.type !== options.acceptedType
        ) {
          throw new Error(`Invalid ${options.label} export file`);
        }
        options.onImport(data);
      } catch (err) {
        console.error(`Failed to import ${options.label}:`, err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
}
