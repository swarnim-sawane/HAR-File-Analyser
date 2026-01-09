// src/utils/harParser.ts
import { HarFile, HarLog, Entry } from '../types/har';

export class HarParser {
  private harData: HarFile | null = null;

  parseFile(file: File): Promise<HarFile> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const parsed: HarFile = JSON.parse(content);
          
          if (!this.validateHarFile(parsed)) {
            throw new Error('Invalid HAR file format');
          }
          
          this.harData = parsed;
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  private validateHarFile(data: any): data is HarFile {
    return (
      data &&
      data.log &&
      data.log.version &&
      data.log.creator &&
      Array.isArray(data.log.entries)
    );
  }

  getEntries(): Entry[] {
    return this.harData?.log.entries || [];
  }

  getPages() {
    return this.harData?.log.pages || [];
  }

  getCreator() {
    return this.harData?.log.creator;
  }

  getBrowser() {
    return this.harData?.log.browser;
  }
}
