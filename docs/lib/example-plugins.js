// Example plugin fixtures for docs/chat-config.js's "plugins" checkbox list --
// proves the checkbox has a real effect (registers/tears down an actual
// openable app window via docs/lib/plugin.js createPluginHost) rather than
// being cosmetic config. Any host that surfaces 'chat-config-example' in its
// plugin/command list (see chat-config.js refresh()) will get a real,
// working toggle out of the box.
//
// Extracted out of chat-config.js (a configuration-surface module) because
// this is fixture material, not configuration logic.

import { t } from '../vendor/i18n.js';

export const EXAMPLE_PLUGINS = {
  'chat-config-example': {
    name: 'chat-config-example',
    env: { CHAT_CONFIG_EXAMPLE_PLUGIN: '1' },
    tabs: [{
      id: 'chat-config-example-tab',
      name: 'plugin example',
      factory: () => {
        const node = document.createElement('div');
        node.textContent = t('chatConfig.examplePluginBody', 'This window is registered by a real plugin via createPluginHost.use().');
        return { node, dispose() {} };
      },
    }],
    onInit() { console.info('[plugin] chat-config-example: onInit'); },
    onReady() { console.info('[plugin] chat-config-example: onReady (tab opened)'); },
    onDestroy() { console.info('[plugin] chat-config-example: onDestroy'); },
  },
};
