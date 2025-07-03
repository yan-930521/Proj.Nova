export const orderPromise = async <T>(promiseArray: Promise<T>[]): Promise<T[]> => {
    const results: T[] = [];
    for (const p of promiseArray) {
        try {
            const data = await p;
            results.push(data);
        } catch (error) {
            let resultMsg: string = "Unknown error";
            if(error instanceof Error) resultMsg = error.message;
            else if(typeof error === "string") resultMsg = error;
            throw new Error(`Promise failed: ${resultMsg}`);
        }
    }
    return results;
}