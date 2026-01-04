export interface LocalChecklist {
  id: string;
  title: string;
  description?: string;
  isPublic: boolean;
  author?: string;
  createdAt: string;
  sections: LocalSection[];
  progress: Record<string, boolean>;
}

export interface LocalSection {
  id: string;
  title: string;
  order: number;
  items: LocalItem[];
}

export interface LocalItem {
  id: string;
  title: string;
  description?: string;
  order: number;
  completed?: boolean;
  tags?: string[];
}

export class LocalStorageManager {
  private static readonly CHECKLISTS_KEY = 'checklist-app-lists';
  private static readonly PROGRESS_KEY = 'checklist-app-progress';

  static getAllChecklists(): LocalChecklist[] {
    try {
      const stored = localStorage.getItem(this.CHECKLISTS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading checklists from localStorage:', error);
      return [];
    }
  }

  static getChecklist(id: string): LocalChecklist | null {
    const checklists = this.getAllChecklists();
    return checklists.find(list => list.id === id) || null;
  }

  static saveChecklist(checklist: LocalChecklist): void {
    try {
      const checklists = this.getAllChecklists();
      const existingIndex = checklists.findIndex(list => list.id === checklist.id);

      if (existingIndex >= 0) {
        checklists[existingIndex] = checklist;
      } else {
        checklists.push(checklist);
      }

      localStorage.setItem(this.CHECKLISTS_KEY, JSON.stringify(checklists));
    } catch (error) {
      console.error('Error saving checklist to localStorage:', error);
    }
  }

  static deleteChecklist(id: string): void {
    try {
      const checklists = this.getAllChecklists();
      const filtered = checklists.filter(list => list.id !== id);
      localStorage.setItem(this.CHECKLISTS_KEY, JSON.stringify(filtered));

      this.clearProgress(id);
    } catch (error) {
      console.error('Error deleting checklist from localStorage:', error);
    }
  }

  static getProgress(checklistId: string): Record<string, boolean> {
    try {
      const stored = localStorage.getItem(`${this.PROGRESS_KEY}-${checklistId}`);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Error reading progress from localStorage:', error);
      return {};
    }
  }

  static updateProgress(checklistId: string, itemId: string, completed: boolean): void {
    try {
      const progress = this.getProgress(checklistId);
      progress[itemId] = completed;
      localStorage.setItem(`${this.PROGRESS_KEY}-${checklistId}`, JSON.stringify(progress));
    } catch (error) {
      console.error('Error updating progress in localStorage:', error);
    }
  }

  static clearProgress(checklistId: string): void {
    try {
      localStorage.removeItem(`${this.PROGRESS_KEY}-${checklistId}`);
    } catch (error) {
      console.error('Error clearing progress from localStorage:', error);
    }
  }

  static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}