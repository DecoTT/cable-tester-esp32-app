
class FileService {
  private baseUrl = 'http://localhost:3001/api';

  // Database synchronization
  async syncSkuDatabase(skus: any[]) {
    try {
      const response = await fetch(`${this.baseUrl}/database/skus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ skus }),
      });
      return await response.json();
    } catch (error) {
      console.error('Error syncing SKU database:', error);
      return { success: false, message: 'Error syncing SKU database' };
    }
  }

  async syncCodigosDatabase(codigos: any[]) {
    try {
      const response = await fetch(`${this.baseUrl}/database/codigos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ codigos }),
      });
      return await response.json();
    } catch (error) {
      console.error('Error syncing Codigos database:', error);
      return { success: false, message: 'Error syncing Codigos database' };
    }
  }

  async syncLotesDatabase(lotes: any[]) {
    try {
      const response = await fetch(`${this.baseUrl}/database/lotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lotes }),
      });
      return await response.json();
    } catch (error) {
      console.error('Error syncing Lotes database:', error);
      return { success: false, message: 'Error syncing Lotes database' };
    }
  }

  async loadSkuDatabase() {
    try {
      const response = await fetch(`${this.baseUrl}/database/skus`);
      return await response.json();
    } catch (error) {
      console.error('Error loading SKU database:', error);
      return { success: false, data: [] };
    }
  }

  async loadCodigosDatabase() {
    try {
      const response = await fetch(`${this.baseUrl}/database/codigos`);
      return await response.json();
    } catch (error) {
      console.error('Error loading Codigos database:', error);
      return { success: false, data: [] };
    }
  }

  async loadLotesDatabase() {
    try {
      const response = await fetch(`${this.baseUrl}/database/lotes`);
      return await response.json();
    } catch (error) {
      console.error('Error loading Lotes database:', error);
      return { success: false, data: [] };
    }
  }

  // Log management
  async getAvailableLogDates() {
    try {
      const response = await fetch(`${this.baseUrl}/logs/list`);
      return await response.json();
    } catch (error) {
      console.error('Error getting log dates:', error);
      return { success: false, dates: [] };
    }
  }

  async getLogsForDate(date: string, type?: string) {
    try {
      const url = type 
        ? `${this.baseUrl}/logs/${date}?type=${type}`
        : `${this.baseUrl}/logs/${date}`;
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      console.error('Error getting logs for date:', error);
      return { success: false, files: {} };
    }
  }

  async exportLogs(startDate: string, endDate: string, types: string[]) {
    try {
      const response = await fetch(`${this.baseUrl}/logs/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ startDate, endDate, types }),
      });
      return await response.json();
    } catch (error) {
      console.error('Error exporting logs:', error);
      return { success: false, message: 'Error exporting logs' };
    }
  }

  // Helper methods
  getCurrentDateString() {
    const now = new Date();
    return now.getFullYear().toString() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
  }
}

export const fileService = new FileService();
