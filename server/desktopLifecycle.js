const DESKTOP_READY_PREFIX = 'PRAX_DESKTOP_READY ';

export function desktopReadyLine(address) {
  const url = new URL(String(address));
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Desktop server announced an invalid loopback address: ${address}`);
  }
  return `${DESKTOP_READY_PREFIX}${JSON.stringify({ port })}\n`;
}

export function createGracefulShutdown({ close, exit = () => {} }) {
  let outcome;
  return function shutdown() {
    if (outcome) return outcome;
    outcome = (async () => {
      try {
        await close();
        exit(0);
        return 0;
      } catch (error) {
        exit(1, error);
        return 1;
      }
    })();
    return outcome;
  };
}

export function installDesktopStdinControl({ input, shutdown }) {
  let buffer = '';
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    input.off('data', onData);
  }

  function onData(chunk) {
    buffer += String(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const command = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (command === 'shutdown') {
        dispose();
        void shutdown();
        return;
      }
    }
  }

  input.setEncoding?.('utf8');
  input.on('data', onData);
  input.resume?.();
  return dispose;
}

export function announceDesktopReady(output, address) {
  output.write(desktopReadyLine(address));
}
