import { rconHealth, whitelistAdd, whitelistRemove } from "../lib/rcon.js";
import type { McBridge } from "../services/ports.js";

export const rconBridge: McBridge = {
  whitelistAdd: (nick) => whitelistAdd(nick),
  whitelistRemove: (nick) => whitelistRemove(nick),
};

export { rconHealth };
