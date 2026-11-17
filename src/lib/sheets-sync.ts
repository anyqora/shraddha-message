import "server-only";
import type { AppEvent } from "./events";

export async function handleEvent(_event: AppEvent): Promise<void> {}
