/**
 * Loader shim for the pi-chat extension.
 *
 * Keep this as a real file instead of a symlink: Pi's extension auto-loader may
 * skip symlinked *.ts entries when scanning ~/.pi/agent/extensions.
 */
export { default } from "../git/pi-chat/extension/pi-chat.ts";
