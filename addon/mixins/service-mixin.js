import { debug } from '@ember/debug';
import { isNone } from '@ember/utils';
import { deprecate } from '@ember/application/deprecations';
import { getOwner } from '@ember/application';
import { computed } from '@ember/object';
import { inject as service } from '@ember/service';
import Mixin from '@ember/object/mixin';
import fetch from 'fetch';

export default Mixin.create({
  session: service('session'),

  hostAppConfig: computed(function () {
    return getOwner(this).resolveRegistration('config:environment');
  }),

  defaultParams: {
    f: 'json'
  },

  portalRestUrl: computed('session.portalHostname', function () {
    deprecate('use .getPortalRestUrl()', false, {id: 'portalRestUrlDeprecation', until: '10.0.0'});
    return this.getPortalRestUrl();
  }),

  /**
   * Return the ArcGIS Portal Rest base url
   */
  getPortalRestUrl (portalOptions = {}) {
    const baseUrl = this.getPortalUrl(portalOptions);
    return `${baseUrl}/sharing/rest`;
  },

  portalUrl: computed('session.portalHostname', function () {
    deprecate('use .getPortalUrl()', false, {id: 'portalUrlDeprecation', until: '10.0.0'});
    return this.getPortalUrl();
  }),

  /**
   * Return the ArcGIS Portal base url (for visiting pages etc)
   * Defaults to https because there is no negative to using it
   */
  // NOTE: DO NOT CHANGE THIS FUNCTION
  // instead we need to de-duplicate the logic from torii-provider-arcgis
  // see: https://github.com/Esri/torii-provider-arcgis/blob/v2.0.0/addon/mixins/gatekeeper.js#L176-L201
  // we should figure out how to extract the underlying utility fns into rest-js
  // or some other common place so they can be applied to portalOptions.portalHostname here
  getPortalUrl (portalOptions = {}) {
    const portalHostname = portalOptions.portalHostname || this.get('session.portalHostname');
    let host;
    if (/^\./.test(portalHostname)) {
      host = portalHostname;
    } else if (/^https?:\/\//.test(portalHostname)) {
      host = portalHostname;
    } else {
      host = `https://${portalHostname}`;
    }

    if (this.get('session.portal.isPortal')) {
      return this.fixUrl(host, this.get('session.portal'), location.protocol);
    } else {
      return host;
    }
  },

  fixUrl (url, portal, currentProtocol) {
    // So portal self is stupid and only knows its http hostname
    // there might be no web adapter enabled so standard ports may not apply
    // therefore we have to reconstitute the url with the https port from portal self
    const parser = document.createElement('a');
    parser.href = url;
    if (currentProtocol === 'https:' && parser.port) {
      parser.protocol = 'https:';
      parser.port = portal.httpsPort;
    }
    return parser.href;
  },

  encodeForm (form = {}) {
    if (typeof form === 'string') { return form; }

    return Object.keys(form).reduce((acc, key) => {
      if (!isNone(form[key])) {
        acc.push([key, form[key]].map(encodeURIComponent).join('='));
      }
      return acc;
    }, []).join('&');
  },

  /**
   * Fetch does not reject on non-200 responses, so we need to check this manually
   */
  checkStatusAndParseJson (response) {
    let error;
    if (response.status >= 200 && response.status < 300) {
      // check if this is one of those groovy 200-but-a-400 things
      return response.json().then((json) => {
        if (json.error) {
          // cook an error
          error = new Error(json.error.message);
          error.code = json.error.code || 404;
          error.response = response;
          debug('Error in response:  ' + json.error.message);
          throw error;
        } else {
          return json;
        }
      });
    } else {
      // Response has non 200 http code
      error = new Error('Got ' + response.status + ' ' + response.statusText);
      throw error;
    }
  },

  /**
   * Fetch based request method
   */
  request (urlPath, options, portalOpts) {
    let url = `${this.getPortalRestUrl(portalOpts)}${urlPath}`;
    return this.requestUrl(url, options, portalOpts);
  },

  /**
   * Make a request using a fully-formed url. This was added to allow
   * the hosted-fs-service to make calls to the hosted service using
   * its fully qualifed url.
   */
  requestUrl (url, options, portalOpts) {
    let opts = options || {};
    if (opts.method && opts.method === 'POST') {
      // if we are POSTing, we need to manually set the content-type because AGO
      // actually does care about this header
      if (!opts.headers) {
        opts.headers = {
          'Accept': 'application/json, application/xml, text/plain, text/html, *.*',
          'Content-Type': 'application/x-www-form-urlencoded'
        };
      }
      // if a body was passed, we need to set the content type to multipart
      if (opts.body) {
        delete opts.headers['Content-Type'];// = 'multipart/form-data';
      }

      // if we have a data, create a formData from it
      if (opts.data) {
        var form = this.encodeForm(opts.data);
        opts.body = form;
      }
    }
    // if we have not overridden credentials, set it to same-origin
    // which replicates the same behavior as XMLHttpRequest
    // This is needed to allow credentials to be send in the scenario
    // where a Portal is configured for web-tier authentication
    // There is no downside to having this as a default.
    if (!opts.credentials) {
      opts.credentials = 'same-origin';
    }

    // append in the token
    // if portalOpts was provided use it even if it is undefined
    // this is so we can make unauthenticated requests by passing portalOpts without a token
    const token = portalOpts ? portalOpts.token : this.get('session.token');
    if (token) {
      // add a token
      if (url.indexOf('?') > -1) {
        url = url + '&token=' + token;
      } else {
        url = url + '?token=' + token;
      }
    }

    // Ember.debug('Portal Services making request to: ' + url);
    return fetch(url, opts)
    // we need the => here, just .then(this.checkStatusAndParseJson) causes problems with rejection
    .then((resp) => {
      return this.checkStatusAndParseJson(resp);
    });
  },

  /**
   * Wrap the options passed to rest-js with auth info and use ember-fetch.
   */
  addOptions (args, portalOpts) {
    if (portalOpts) {
      // instead of getting portal and autentication from session
      // use what has been explicitly passed in via portalOpts
      let portal = this.getPortalRestUrl(portalOpts);
      if (portalOpts.token) {
        // make an authenticated request by constructing a one-time IAuthenticationManger
        args.authentication = {
          portal,
          getToken: function () {
            return Promise.resolve(portalOpts.token);
          }
        };
      } else {
        // just make an unauthenticated request to this portal
        args.portal = portal;
      }
    } else {
      // get portal and authtentication from the session
      let correctPortalRestUrl = this.getPortalRestUrl();
      let authMgr = this.get('session.authMgr');
      if (authMgr) {
        // first verify that the cached authentication has the right portal
        // NOTE: as of torii-provider-arcgis@2.0.0 this check should no longer be necessary
        // TODO: remove once we are sure that it is no longer needed
        if (authMgr.portal !== correctPortalRestUrl) {
          console.warn(`AuthMgr.portal (${authMgr.portal}) does not match session.portalHostname (${this.get('session.portalHostname')})`);
          this.set('session.authMgr.portal', correctPortalRestUrl);
        }
        args.authentication = authMgr;
      } else {
        // user is unauthenticated, but we may still have a portalHostname
        args.portal = correctPortalRestUrl;
      }
    }

    // always use ember-fetch
    args.fetch = fetch;
    return args;
  }
});
