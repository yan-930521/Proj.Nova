import { EventEmitter } from 'node:events';

export interface Listener<T> {
    (event: T): any;
}
export interface Disposable {
    dispose(): any;
}

export class TypedEvent<TEvents extends Record<string, any>>  {
    private emitter: EventEmitter = new EventEmitter();

    on<TEventName extends keyof TEvents & string>(
        eventName: TEventName,
        handler: (...eventArg: TEvents[TEventName]) => void
    ) {
        this.emitter.on(eventName, handler as any);
    }

    emit<TEventName extends keyof TEvents & string>(
        eventName: TEventName,
        ...eventArg: TEvents[TEventName]
    ) {
        this.emitter.emit(eventName, ...(eventArg as any));
    }
    
    off<TEventName extends keyof TEvents & string>(
        eventName: TEventName,
        handler: (...eventArg: TEvents[TEventName]) => void
    ) {
        this.emitter.off(eventName, handler as any);
    }
}