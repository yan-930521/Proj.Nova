import { User as DUser } from 'discord.js';
import { z } from 'zod';

export class User {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public extraData: Partial<z.infer<typeof UserState>> = {} // 新增的欄位
    ) {

    }

    public static fromDiscordUser(user: DUser): User {
        return new User(user.id, user.globalName ?? user.username);
    }

    public static fromJSON(userdata: User): User {
        let u = new User(userdata.id, userdata.name, userdata.extraData ?? {});
        return u;
    }

    public toString() {
        let str = `ID: ${this.id}\nName: ${this.name}\nState Data:\n`;
        for (let i in this.extraData) {
            let data: string | number | string[] | undefined = this.extraData[i as keyof z.infer<typeof UserState>];
            str += `${i}: `;

            if (typeof data === "string" || typeof data === "number") {
                str += `${data}\n`;
            } else if (Array.isArray(data)) {
                str += `${data.join(", ")}\n`;
            } else {
                str += `None\n`;
            }
        }

        return str;
    }
}
export const UserState = z.object({
    user_name: z.string().describe("The user's preferred name"),
    age: z.number().default(0).describe("The user's age"),
    relationship_status: z.string().describe("The user's relationship status (e.g., single, married, partnered)"),
    education_level: z.string().describe("The user's highest level of education (e.g., high school, bachelor's, master's)"),
    occupation: z.string().describe("The user's current occupation or profession"),

    interests: z.array(z.string()).default([])
        .describe("A list of the user's interests, which can be added to or removed from as needed"),
    hobbies: z.array(z.string()).default([])
        .describe("A list of the user's hobbies or activities the user enjoys, which can be added to or removed from as needed"),

    preferred_language: z.string().describe("The user's preferred language for communication)"),
    location: z.string().describe("The user's current location name, such as a store, convenience shop, landmark, city, or region"),
    timezone: z.string().describe("The user's timezone (e.g., UTC, PST, EST)"),
    home: z.string().describe("Description of the user's home town/neighborhood, etc."),

    conversation_preferences: z.array(z.string()).default([]).describe("A list of the user's preferred conversation styles, pronouns, topics they want to avoid, etc."),
});