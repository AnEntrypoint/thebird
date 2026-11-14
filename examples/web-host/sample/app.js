const hostLocation = document.querySelector('#host-location');
const serverState = document.querySelector('#server-state');
const assetState = document.querySelector('#asset-state');
hostLocation.textContent = window.location.href;
serverState.textContent = 'HTTP response received';
assetState.textContent = 'HTML, CSS and JavaScript active';
document.body.dataset.ready = 'true';
document.body.dataset.style = getComputedStyle(document.body).margin === '0px' ? 'loaded' : 'missing';
