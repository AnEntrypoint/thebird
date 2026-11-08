(function (bridge) {
    const clients = new Map();
    let nextId = 1;

    const send = (message) => bridge(JSON.stringify(message));

    const toBase64 = (bytes) => {
        let binary = '';

        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }

        return btoa(binary);
    };

    const fromBase64 = (text) => {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return bytes;
    };

    const bytesOf = (data) => {
        if (data === null || data === undefined) {
            return null;
        }

        if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
        }

        if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }

        return new TextEncoder().encode(String(data));
    };

    const concat = (parts) => {
        const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
        const out = new Uint8Array(total);
        let offset = 0;

        for (const part of parts) {
            out.set(part, offset);
            offset += part.byteLength;
        }

        return out;
    };

    class NativeHttpClient {
        constructor() {
            this.id = nextId++;
            this.timeout = 0;
            this.streaming = false;
            this.cookies = false;
            this.headers = [];
            this.chunks = [];
            clients.set(this.id, this);
        }

        setRequestHeader(name, value) {
            this.headers.push([ String(name), String(value) ]);
        }

        setEnableCookies(enable) {
            this.cookies = !!enable;
        }

        setAllowInsecure() {
        }

        open(method, url, body) {
            this.method = method;
            this.url = url;

            if (this.streaming) {
                Promise.resolve().then(() => this.ondrain?.());

                return;
            }

            this.start(bytesOf(body));
        }

        sendData(data) {
            if (data === null || data === undefined) {
                this.start(concat(this.chunks));

                return;
            }

            this.chunks.push(bytesOf(data));
            Promise.resolve().then(() => this.ondrain?.());
        }

        start(body) {
            send({
                op: 'open',
                id: this.id,
                method: this.method,
                url: this.url,
                headers: this.headers,
                body: body ? toBase64(body) : null,
                timeout: this.timeout,
                credentials: this.cookies ? 'include' : 'same-origin',
            });
        }

        abort() {
            if (clients.has(this.id)) {
                send({ op: 'abort', id: this.id });
            }
        }
    }

    const deliver = (text) => {
        const event = JSON.parse(text);
        const client = clients.get(event.id);

        if (!client) {
            return;
        }

        switch (event.kind) {
            case 'status':
                client.onstatus?.(event.status);
                break;
            case 'url':
                client.onurl?.(event.url);
                break;
            case 'header':
                client.onheader?.(event.name, event.value);
                break;
            case 'headersend':
                client.onheadersend?.();
                break;
            case 'data':
                client.ondata?.(fromBase64(event.data).buffer);
                break;
            case 'complete':
                clients.delete(event.id);
                client.oncomplete?.(event.error || null, event.reason || null);
                break;
        }
    };

    return { HttpClient: NativeHttpClient, deliver };
})
