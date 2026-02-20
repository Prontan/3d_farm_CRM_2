import { Order, Printer, ProductTemplate, StockItem, ColorDef, Plate, FilamentStock, GlobalSettings } from '../types';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc,
  Firestore,
  enableIndexedDbPersistence,
  query,
  where,
  limit,
  orderBy
} from 'firebase/firestore';

// --- КОНФИГУРАЦИЯ FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyC2uKqP9RmTU1CWINXzlXLJLTtx-vF2lZM",
  authDomain: "cobalt-ship-415103.firebaseapp.com",
  projectId: "cobalt-ship-415103",
  storageBucket: "cobalt-ship-415103.firebasestorage.app",
  messagingSenderId: "591573052276",
  appId: "1:591573052276:web:dcf68fbc1f644ea1775a21"
};

// Инициализация приложения
let app;
let dbInstance: Firestore | null = null;

try {
  // Ensure API key is trimmed to avoid copy-paste errors
  const cleanConfig = { ...firebaseConfig, apiKey: firebaseConfig.apiKey.trim() };
  
  app = initializeApp(cleanConfig);
  
  // Подключаемся к новой базе данных 'dcrmv2' напрямую
  dbInstance = getFirestore(app, "dcrmv2");

  // Включение оффлайн-кэширования для экономии трафика
  if (typeof window !== 'undefined') {
      enableIndexedDbPersistence(dbInstance).catch((err) => {
          if (err.code == 'failed-precondition') {
              console.warn('Persistence failed: Multiple tabs open');
          } else if (err.code == 'unimplemented') {
              console.warn('Persistence not supported by browser');
          }
      });
  }

} catch (e) {
  console.error("Firebase init error:", e);
}

class FarmAPI {
  private isAuthenticatedUser: boolean = false;

  constructor() {
    this.checkAuthPersistence();
  }

  isConfigured(): boolean {
    return !!dbInstance;
  }

  // --- Auth (Локальная проверка пароля для входа в интерфейс) ---

  private checkAuthPersistence() {
    const saved = localStorage.getItem('auth_session') || sessionStorage.getItem('auth_session');
    if (saved === 'active') {
      this.isAuthenticatedUser = true;
    }
  }

  isAuthenticated(): boolean {
    return this.isAuthenticatedUser;
  }

  async login(username: string, password: string, rememberMe: boolean): Promise<boolean> {
    // Имитация авторизации на клиенте (UI)
    if (username.toLowerCase() === 'mihail' && password === '250364') {
      this.isAuthenticatedUser = true;
      if (rememberMe) {
        localStorage.setItem('auth_session', 'active');
      } else {
        sessionStorage.setItem('auth_session', 'active');
      }
      return true;
    }
    return false;
  }

  logout() {
    this.isAuthenticatedUser = false;
    localStorage.removeItem('auth_session');
    sessionStorage.removeItem('auth_session');
    window.location.reload();
  }

  // --- Методы работы с данными (FIRESTORE) ---
  
  private async getCollection<T>(collectionName: string): Promise<T[]> {
    if (!dbInstance) return [];
    try {
      // Стандартный запрос получает данные из кэша, если возможно, затем с сервера
      const querySnapshot = await getDocs(collection(dbInstance, collectionName));
      const data: T[] = [];
      querySnapshot.forEach((doc) => {
        data.push(doc.data() as T);
      });
      return data;
    } catch (e: any) {
      console.error(`Error getting collection ${collectionName}:`, e.code, e.message);
      throw e; 
    }
  }

  private async setDocument<T>(collectionName: string, id: string, item: T): Promise<void> {
    if (!dbInstance) return;
    try {
      // @ts-ignore
      await setDoc(doc(dbInstance, collectionName, id), item);
    } catch (e) {
      console.error(`Error setting document ${collectionName}/${id}:`, e);
      throw e;
    }
  }

  private async deleteDocument(collectionName: string, id: string): Promise<void> {
    if (!dbInstance) return;
    try {
      await deleteDoc(doc(dbInstance, collectionName, id));
    } catch (e) {
      console.error(`Error deleting document ${collectionName}/${id}:`, e);
      throw e;
    }
  }

  // Orders - ОПТИМИЗАЦИЯ ТРАФИКА
  // Вместо загрузки всего, загружаем только активные заказы
  async getActiveOrders(): Promise<Order[]> {
    if (!dbInstance) return [];
    try {
      // Загружаем только те, что НЕ в архиве (не SHIPPED и не STORED)
      // Firestore 'not-in' поддерживает до 10 значений
      const q = query(
        collection(dbInstance, 'orders'), 
        where('status', 'not-in', ['SHIPPED', 'STORED'])
      );
      
      const querySnapshot = await getDocs(q);
      const data: Order[] = [];
      querySnapshot.forEach((doc) => data.push(doc.data() as Order));
      return data;
    } catch (e) {
      console.error("Error getting active orders:", e);
      return [];
    }
  }

  // Загрузка истории с лимитом (Pagination)
  async getArchivedOrders(limitCount: number = 50): Promise<Order[]> {
    if (!dbInstance) return [];
    try {
      const q = query(
        collection(dbInstance, 'orders'),
        where('status', 'in', ['SHIPPED', 'STORED']),
        orderBy('createdAt', 'desc'), // Нужен индекс в Firestore. Если нет, может упасть, тогда убрать orderBy
        limit(limitCount)
      );
      
      // Fallback: Если индекс не создан, просто грузим лимит без сортировки на сервере
      // (В реальном проекте нужно создать индекс по ссылке в консоли)
      
      const querySnapshot = await getDocs(q);
      const data: Order[] = [];
      querySnapshot.forEach((doc) => data.push(doc.data() as Order));
      return data;
    } catch (e: any) {
       // Если ошибка индекса, пробуем без сортировки
       if (e.code === 'failed-precondition') {
          console.warn("Missing index for sort, fetching basic limit");
          const qBackup = query(
            collection(dbInstance, 'orders'),
            where('status', 'in', ['SHIPPED', 'STORED']),
            limit(limitCount)
          );
          const snap = await getDocs(qBackup);
          const data: Order[] = [];
          snap.forEach((doc) => data.push(doc.data() as Order));
          return data;
       }
       console.error("Error getting archived orders:", e);
       return [];
    }
  }

  // Legacy метод для совместимости экспорта (грузит всё)
  async getOrders(): Promise<Order[]> { return this.getCollection<Order>('orders'); }
  
  async saveOrder(order: Order): Promise<void> { return this.setDocument('orders', order.id, order); }
  async deleteOrder(id: string): Promise<void> { return this.deleteDocument('orders', id); }

  // Printers
  async getPrinters(): Promise<Printer[]> { return this.getCollection<Printer>('printers'); }
  async savePrinter(p: Printer): Promise<void> { return this.setDocument('printers', p.id, p); }
  async deletePrinter(id: string): Promise<void> { return this.deleteDocument('printers', id); }

  // Templates
  async getTemplates(): Promise<ProductTemplate[]> { return this.getCollection<ProductTemplate>('templates'); }
  async saveTemplate(t: ProductTemplate): Promise<void> { return this.setDocument('templates', t.id, t); }
  async deleteTemplate(id: string): Promise<void> { return this.deleteDocument('templates', id); }

  // Stock
  async getStock(): Promise<StockItem[]> { return this.getCollection<StockItem>('stock'); }
  async saveStockItem(item: StockItem): Promise<void> { return this.setDocument('stock', item.id, item); }
  async deleteStockItem(id: string): Promise<void> { return this.deleteDocument('stock', id); }

  // Global Parts (Library)
  async getParts(): Promise<Plate[]> { return this.getCollection<Plate>('parts'); }
  async savePart(part: Plate): Promise<void> { return this.setDocument('parts', part.id, part); }
  async deletePart(id: string): Promise<void> { return this.deleteDocument('parts', id); }

  // Filament Stock
  async getFilamentStock(): Promise<FilamentStock[]> { 
    if (!dbInstance) return [];
    try {
      const docRef = doc(dbInstance, 'inventory', 'filament');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data().items as FilamentStock[];
      } else {
        return [];
      }
    } catch (e) {
      console.error("Error getting filament:", e);
      return [];
    }
  }

  async saveFilamentStock(items: FilamentStock[]): Promise<void> {
    if (!dbInstance) return;
    try {
      await setDoc(doc(dbInstance, 'inventory', 'filament'), { items });
    } catch (e) {
      console.error("Error saving filament:", e);
    }
  }

  // Colors
  async getColors(): Promise<ColorDef[] | null> { 
    if (!dbInstance) return [];
    try {
      const docRef = doc(dbInstance, 'settings', 'colors');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data().items as ColorDef[];
      } else {
        return null;
      }
    } catch (e) {
      console.error("Error getting colors:", e);
      return [];
    }
  }
  
  async saveColors(colors: ColorDef[]): Promise<void> { 
    if (!dbInstance) return;
    try {
      await setDoc(doc(dbInstance, 'settings', 'colors'), { items: colors });
    } catch (e) {
      console.error("Error saving colors:", e);
    }
  }

  // Global Settings
  async getGlobalSettings(): Promise<GlobalSettings> {
    if (!dbInstance) return { wastePercentage: 0 };
    try {
      const docRef = doc(dbInstance, 'settings', 'general');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as GlobalSettings;
      } else {
        return { wastePercentage: 0 };
      }
    } catch (e) {
      console.error("Error getting global settings:", e);
      return { wastePercentage: 0 };
    }
  }

  async saveGlobalSettings(settings: GlobalSettings): Promise<void> {
    if (!dbInstance) return;
    try {
      await setDoc(doc(dbInstance, 'settings', 'general'), settings);
    } catch (e) {
      console.error("Error saving global settings:", e);
    }
  }

  // Export
  async exportData() {
    if (!dbInstance) return {};
    try {
      // Для бэкапа грузим всё
      const [orders, printers, templates, stock, colors, parts, filament, settings] = await Promise.all([
        this.getOrders(),
        this.getPrinters(),
        this.getTemplates(),
        this.getStock(),
        this.getColors(),
        this.getParts(),
        this.getFilamentStock(),
        this.getGlobalSettings()
      ]);
      
      return {
        version: 1,
        timestamp: new Date().toISOString(),
        orders,
        printers,
        templates,
        stock,
        colors: colors || [],
        parts: parts || [],
        filament: filament || [],
        settings
      };
    } catch (e) {
      console.error("Error exporting data:", e);
      throw e;
    }
  }

  // Import
  async importData(data: any) {
    if (!dbInstance) return;
    const promises: Promise<void>[] = [];
    if (data.orders && Array.isArray(data.orders)) data.orders.forEach((o: Order) => promises.push(this.saveOrder(o)));
    if (data.printers && Array.isArray(data.printers)) data.printers.forEach((p: Printer) => promises.push(this.savePrinter(p)));
    if (data.templates && Array.isArray(data.templates)) data.templates.forEach((t: ProductTemplate) => promises.push(this.saveTemplate(t)));
    if (data.stock && Array.isArray(data.stock)) data.stock.forEach((s: StockItem) => promises.push(this.saveStockItem(s)));
    if (data.parts && Array.isArray(data.parts)) data.parts.forEach((p: Plate) => promises.push(this.savePart(p)));
    if (data.colors && Array.isArray(data.colors)) promises.push(this.saveColors(data.colors));
    if (data.filament && Array.isArray(data.filament)) promises.push(this.saveFilamentStock(data.filament));
    if (data.settings) promises.push(this.saveGlobalSettings(data.settings));
    await Promise.all(promises);
  }
}

export const db = new FarmAPI();