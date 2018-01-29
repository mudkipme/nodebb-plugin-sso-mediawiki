# NodeBB OAuth SSO for MediaWiki

[![NPM version](https://img.shields.io/npm/v/nodebb-plugin-sso-mediawiki.svg)](https://npmjs.org/package/nodebb-plugin-sso-mediawiki)

This plugin is a fork of [nodebb-plugin-sso-oauth](https://github.com/julianlam/nodebb-plugin-sso-oauth) to work with [MediaWiki](https://www.mediawiki.org/).

## Usage

Please install [Extension:OAuth](https://www.mediawiki.org/wiki/Extension:OAuth) on your MediaWiki installation first.

You'll also need to propose and authorize a OAuth application with MediaWiki. The `callback` URL should be `https://YOUR_NODEBB_HOST/auth/wiki/callback`.

After install this plugin, please modify the `config.json` of your NodeBB, or use environment variables instead:

```
{
    ...
    "oauth": {
        "root": "your mediawiki script path, eg: https://en.wikipedia.org/w/",
        "key": "your consumer key",
        "secret": "your consumer secret"
    }
    ...
}
```

## See also

Please see [nodebb-plugin-sso-oauth](https://github.com/julianlam/nodebb-plugin-sso-oauth) to configurate with OAuth provider other than MediaWiki.
