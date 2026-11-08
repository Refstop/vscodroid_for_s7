// Executed in the existing workbench page before it constructs its services.
// This changes the connection, never the frontend, origin, profile or preferences.
var remote = window.__vscodroidRemoteWorkspace;
var bridgeId = 'vscodroid.vscodroid-saf-bridge';
settings.enabledExtensionProposedApi = (settings.enabledExtensionProposedApi || []).concat(bridgeId);
if (remote) {
    settings.configurationDefaults = Object.assign({}, LOCAL_UI_DEFAULTS, settings.configurationDefaults);
    settings.remoteAuthority = remote.authority;
    settings.windowIndicator = { label: '$(remote) SSH: ' + remote.label, tooltip: 'Connected over SSH to ' + remote.label };
    settings.additionalBuiltinExtensions = (settings.additionalBuiltinExtensions || []).concat(
        LOCAL_UI_EXTENSIONS.map(function (name) {
            return { scheme: 'http', authority: location.host, path: LOCAL_UI_PATH + '/' + name };
        })
    );
}
