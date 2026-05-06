type UploadPathFile = File & { uploadRelativePath?: string };

interface BrowserFileSystemEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

interface BrowserFileSystemFileEntry extends BrowserFileSystemEntry {
  file: (
    success: (file: File) => void,
    failure?: (error: DOMException) => void,
  ) => void;
}

interface BrowserFileSystemDirectoryEntry extends BrowserFileSystemEntry {
  createReader: () => {
    readEntries: (
      success: (entries: BrowserFileSystemEntry[]) => void,
      failure?: (error: DOMException) => void,
    ) => void;
  };
}

function withUploadRelativePath(file: File, relativePath: string): File {
  Object.defineProperty(file, 'uploadRelativePath', {
    value: relativePath,
    configurable: true,
  });
  return file as UploadPathFile;
}

async function readDirectoryEntries(
  entry: BrowserFileSystemDirectoryEntry,
): Promise<BrowserFileSystemEntry[]> {
  const reader = entry.createReader();
  const out: BrowserFileSystemEntry[] = [];
  for (;;) {
    const chunk = await new Promise<BrowserFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (chunk.length === 0) return out;
    out.push(...chunk);
  }
}

async function fileFromEntry(entry: BrowserFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function collectEntryFiles(
  entry: BrowserFileSystemEntry,
  parentPath: string,
  out: File[],
) {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await fileFromEntry(entry as BrowserFileSystemFileEntry);
    out.push(withUploadRelativePath(file, relativePath));
    return;
  }
  if (!entry.isDirectory) return;
  const children = await readDirectoryEntries(entry as BrowserFileSystemDirectoryEntry);
  for (const child of children) {
    await collectEntryFiles(child, relativePath, out);
  }
}

export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const itemEntries = Array.from(dataTransfer.items ?? [])
    .map((item) => {
      const getEntry = (item as DataTransferItem & {
        webkitGetAsEntry?: () => BrowserFileSystemEntry | null;
      }).webkitGetAsEntry;
      return typeof getEntry === 'function' ? getEntry.call(item) : null;
    })
    .filter((entry): entry is BrowserFileSystemEntry => Boolean(entry));

  if (itemEntries.length === 0) return Array.from(dataTransfer.files ?? []);

  const out: File[] = [];
  for (const entry of itemEntries) {
    await collectEntryFiles(entry, '', out);
  }
  return out;
}
