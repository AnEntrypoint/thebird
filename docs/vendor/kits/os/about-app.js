// About-app paint surface — static info card, bible classes.
// renderAboutApp({brand, tagline, bullets, links}) -> {node, dispose}.
// Consumer provides content; module owns layout + classes.

export function renderAboutApp(opts = {}) {
    const {
        brand = 'thebird / web os',
        tagline = 'browser-native web OS. multi-instance, per-instance fs / worker / shell / browser. no server.',
        bullets = [
            'POSIX terminal · IndexedDB filesystem',
            'OffscreenCanvas worker per instance',
            'CDP-shaped browser pane',
            'libsql via sql.js · freddie host',
            'responsive: phone / tablet / desktop',
        ],
        footer = 'click apps menu for more.',
        links = [
            { href: 'https://github.com/AnEntrypoint/thebird', text: 'source' },
        ],
    } = opts;

    const node = document.createElement('div');
    node.className = 'app-pane';
    node.dataset.component = 'about-app';

    const h2 = document.createElement('h2');
    h2.textContent = brand;
    const p = document.createElement('p');
    p.textContent = tagline;
    const ul = document.createElement('ul');
    for (const b of bullets) {
        const li = document.createElement('li');
        li.textContent = b;
        ul.appendChild(li);
    }
    const foot = document.createElement('p');
    foot.textContent = footer;
    const meta = document.createElement('p');
    meta.className = 'meta';
    links.forEach((l, i) => {
        const a = document.createElement('a');
        a.href = l.href;
        a.textContent = l.text;
        meta.appendChild(a);
        if (i < links.length - 1) meta.appendChild(document.createTextNode(' · '));
    });

    node.append(h2, p, ul, foot, meta);

    return { node, dispose() {} };
}
