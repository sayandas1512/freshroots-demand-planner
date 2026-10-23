import { clientKey } from "./ratelimit";

export const clientRateKey = (name: string, headers: Headers): string => `${name}:${clientKey(headers)}`;
