'use strict';

(function (module) {
	/*
		Welcome to the SSO OAuth plugin! If you're inspecting this code, you're probably looking to
		hook up NodeBB with your existing OAuth endpoint.

		Step 1: Fill in the "constants" section below with the requisite informaton. Either the "oauth"
				or "oauth2" section needs to be filled, depending on what you set "type" to.

		Step 2: Give it a whirl. If you see the congrats message, you're doing well so far!

		Step 3: Customise the `parseUserReturn` method to normalise your user route's data return into
				a format accepted by NodeBB. Instructions are provided there. (Line 146)

		Step 4: If all goes well, you'll be able to login/register via your OAuth endpoint credentials.
	*/

	const User = require.main.require('./src/user');
	const Groups = require.main.require('./src/groups');
	const db = require.main.require('./src/database');
	const authenticationController = require.main.require('./src/controllers/authentication');

	const passport = require.main.require('passport');
	const nconf = require.main.require('nconf');
	const winston = require.main.require('winston');

	/**
	 * REMEMBER
	 *   Never save your OAuth Key/Secret or OAuth2 ID/Secret pair in code! It could be published and leaked accidentally.
	 *   Save it into your config.json file instead:
	 *
	 *   {
	 *     ...
	 *     "oauth": {
	 *       "id": "someoauthid",
	 *       "secret": "youroauthsecret"
	 *     }
	 *     ...
	 *   }
	 *
	 *   ... or use environment variables instead:
	 *
	 *   `OAUTH__ID=someoauthid OAUTH__SECRET=youroauthsecret node app.js`
	 */

	let scriptPath = nconf.get('oauth:root') || 'https://en.wikipedia.org/w/';
	if (scriptPath.substr(-1) !== '/') {
		scriptPath += '/';
	}

	const constants = Object.freeze({
		type: 'oauth',
		name: nconf.get('oauth:name') || 'wiki',
		oauth: {
			requestTokenURL: scriptPath + 'index.php?title=Special:OAuth/initiate',
			accessTokenURL: scriptPath + 'index.php?title=Special:OAuth/token',
			userAuthorizationURL: scriptPath + 'index.php?title=Special:OAuth/authorize',
			consumerKey: nconf.get('oauth:key'),
			consumerSecret: nconf.get('oauth:secret'),
		},
		userRoute: scriptPath + 'api.php?action=query&meta=userinfo&uiprop=email&format=json',
	});

	const OAuth = {};
	let configOk = false;
	let passportOAuth;
	let opts;

	if (!constants.name) {
		winston.error('[sso-oauth] Please specify a name for your OAuth provider (library.js:32)');
	} else if (!constants.type || (constants.type !== 'oauth' && constants.type !== 'oauth2')) {
		winston.error('[sso-oauth] Please specify an OAuth strategy to utilise (library.js:31)');
	} else if (!constants.userRoute) {
		winston.error('[sso-oauth] User Route required (library.js:31)');
	} else {
		configOk = true;
	}

	OAuth.getStrategy = function (strategies, callback) {
		if (configOk) {
			passportOAuth = require('passport-oauth')[constants.type === 'oauth' ? 'OAuthStrategy' : 'OAuth2Strategy'];

			if (constants.type === 'oauth') {
				// OAuth options
				opts = constants.oauth;
				opts.callbackURL = nconf.get('url') + '/auth/' + constants.name + '/callback';

				passportOAuth.Strategy.prototype.userProfile = function (token, secret, params, done) {
					this._oauth.get(constants.userRoute, token, secret, function (err, body/* , res */) {
						if (err) {
							return done(err);
						}

						try {
							const json = JSON.parse(body);
							OAuth.parseUserReturn(json, function (err, profile) {
								if (err) return done(err);
								profile.provider = constants.name;

								done(null, profile);
							});
						} catch (e) {
							done(e);
						}
					});
				};
			} else if (constants.type === 'oauth2') {
				// OAuth 2 options
				opts = constants.oauth2;
				opts.callbackURL = nconf.get('url') + '/auth/' + constants.name + '/callback';

				passportOAuth.Strategy.prototype.userProfile = function (accessToken, done) {
					this._oauth2.get(constants.userRoute, accessToken, function (err, body/* , res */) {
						if (err) {
							return done(err);
						}

						try {
							const json = JSON.parse(body);
							OAuth.parseUserReturn(json, function (err, profile) {
								if (err) return done(err);
								profile.provider = constants.name;

								done(null, profile);
							});
						} catch (e) {
							done(e);
						}
					});
				};
			}

			opts.passReqToCallback = true;

			passport.use(constants.name, new passportOAuth(opts, async (req, token, secret, profile, done) => {
				const user = await OAuth.login({
					oAuthid: profile.id,
					handle: profile.displayName,
					email: profile.emails[0].value,
					isAdmin: profile.isAdmin,
				});

				authenticationController.onSuccessfulLogin(req, user.uid);
				done(null, user);
			}));

			strategies.push({
				name: constants.name,
				url: '/auth/' + constants.name,
				callbackURL: '/auth/' + constants.name + '/callback',
				icon: 'fa-wikipedia-w',
				scope: (constants.scope || '').split(','),
			});

			callback(null, strategies);
		} else {
			callback(new Error('OAuth Configuration is invalid'));
		}
	};

	OAuth.parseUserReturn = function (data, callback) {
		// Alter this section to include whatever data is necessary
		// NodeBB *requires* the following: id, displayName, emails.
		// Everything else is optional.

		if (data.query && data.query.userinfo) {
			data = data.query.userinfo;
		}

		const profile = {};
		profile.id = data.id;
		profile.displayName = data.name;
		profile.emails = [{ value: data.email }];

		// Do you want to automatically make somebody an admin? This line might help you do that...
		// profile.isAdmin = data.isAdmin ? true : false;

		callback(null, profile);
	};

	OAuth.login = async (payload) => {
		let uid = await OAuth.getUidByOAuthid(payload.oAuthid);
		if (uid !== null) {
			// Existing User
			return ({
				uid: uid,
			});
		}

		// Check for user via email fallback
		uid = await User.getUidByEmail(payload.email);
		if (!uid) {
			// New user
			uid = await User.create({
				username: payload.handle,
				email: payload.email,
			});
		}

		// Save provider-specific information to the user
		await User.setUserField(uid, constants.name + 'Id', payload.oAuthid);
		await db.setObjectField(constants.name + 'Id:uid', payload.oAuthid, uid);

		if (payload.isAdmin) {
			await Groups.join('administrators', uid);
		}

		return {
			uid: uid,
		};
	};

	OAuth.getUidByOAuthid = async (oAuthid) => db.getObjectField(constants.name + 'Id:uid', oAuthid);

	OAuth.deleteUserData = async function (data) {
		const oAuthIdToDelete = await User.getUserField(data.uid, constants.name + 'Id');
		await db.deleteObjectField(constants.name + 'Id:uid', oAuthIdToDelete);
	};

	// If this filter is not there, the deleteUserData function will fail when getting the oauthId for deletion.
	OAuth.whitelistFields = function (params, callback) {
		params.whitelist.push(constants.name + 'Id');
		callback(null, params);
	};

	module.exports = OAuth;
}(module));
