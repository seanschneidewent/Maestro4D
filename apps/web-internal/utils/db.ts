
const DB_NAME = 'maestro4d_db';
const DB_VERSION = 1;
const FILE_STORE_NAME = 'files';

export interface StoredFile {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  timestamp: number;
}

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = (event) => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
        db.createObjectStore(FILE_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveFileToDB = async (file: File | Blob, name: string, type: string): Promise<string> => {
  const db = await initDB();
  const id = crypto.randomUUID();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([FILE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(FILE_STORE_NAME);
    
    const storedFile: StoredFile = {
      id,
      blob: file instanceof File ? file : new Blob([file], { type }),
      name,
      type,
      timestamp: Date.now()
    };
    
    const request = store.add(storedFile);
    
    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
};

export const getFileFromDB = async (id: string): Promise<StoredFile | null> => {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([FILE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(FILE_STORE_NAME);
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const deleteFileFromDB = async (id: string): Promise<void> => {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([FILE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(FILE_STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

