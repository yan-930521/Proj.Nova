import { BaseComponent } from './BaseComponent';

export abstract class BaseManager<DataType = any, Modules = any, TEvents extends Record<string, any> = {}> extends BaseComponent<TEvents> {
    public modules: Modules = {} as Modules;
    private data: Record<string, DataType> = {};

    protected async loadModules() {
        // 啟動所有模組
        for (const module in this.modules) {
            try {
                await (this.modules[module] as BaseManager | BaseComponent).init();
            } catch (error) {

            }
        }
    }

    /**
     * 
     * @param id 
     * @returns 
     */
    abstract create(id: string, ...arg: any): DataType | Promise<DataType>;

    getDataById(id: string) {
        if (this.data[id] !== undefined) {
            return this.data[id];
        }
        throw this.handleError("Data Not Found.");
    }

    setDataById(id: string, idData: DataType) {
        this.data[id] = idData;
    }

    deleteDataById(id: string) {
        delete this.data[id];
    }
}
