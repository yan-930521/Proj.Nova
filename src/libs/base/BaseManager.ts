import { BaseComponent } from './BaseComponent';

export abstract class BaseManager<DataType = any, Modules = any, TEvents extends Record<string, any> = {}> extends BaseComponent<TEvents> {
    private data: Record<string, DataType> = {};

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
