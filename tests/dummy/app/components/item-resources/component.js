import Ember from 'ember';
import layout from './template';

export default Ember.Component.extend({
  layout,
  itemsService: Ember.inject.service('items-service'),
  session: Ember.inject.service(),
  isLoading: true,
  // Lazy load the resources
  didInsertElement () {
    this._getResources();
  },
  resourceBaseUrl: Ember.computed('session', 'item', function () {
    let portalHostName = this.get('session.portalHostName');
    let item = this.get('item');
    return `//${portalHostName}/sharing/rest/content/items/${item.id}/resources/`;
  }),
  _getResources () {
    this.set('isLoading', true);
    this.get('onFetchResources')()

    .then((resources) => {
      this.set('model', resources);
      this.set('isLoading', false);
    });
  },

  actions: {
    destroy (resource) {
      this.get('onRemoveResource')(resource)
      .then(() => {
        this._getResources();
      });
    },
    filesChanged (files) {
      Ember.debug('Files changed!'); // files[0]
      this.get('onUploadFile')(files[0])
      .then(() => {
        this._getResources();
      });
    },
    sendJson () {
      let obj = {
        foo: 'bar'
      };
      this.get('onJsonUpload')(obj)
      .then(() => {
        this._getResources();
      });
    }
  }
});