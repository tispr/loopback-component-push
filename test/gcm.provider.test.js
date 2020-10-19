// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-component-push
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const extend = require('util')._extend;
const GcmProvider = require('../lib/providers/gcm');
const mockery = require('./helpers/mockery').gcm;
const objectMother = require('./helpers/object-mother');
const loopback = require('@tispr/loopback');

const aDeviceToken = 'a-device-token';
const aDeviceTokenList = [
  'first-device-token',
  'second-device-token',
  'third-device-token',
  'fourth-device-token',
  'fifth-device-token',
];

const ds = loopback.createDataSource('db', {
  connector: loopback.Memory,
});

const Application = loopback.Application;
Application.attachTo(ds);

const PushConnector = require('../');
const Installation = PushConnector.Installation;
Installation.attachTo(ds);

const Notification = PushConnector.Notification;
Notification.attachTo(ds);

describe('GCM provider', function() {
  let provider;

  beforeEach(mockery.setUp);
  beforeEach(setUpFakeTimers);
  beforeEach(function() {
    givenProviderWithConfig();
  });

  afterEach(tearDownFakeTimers);
  afterEach(mockery.tearDown);

  describe('for single device token', function() {
    it('sends Notification as a GCM message', function(done) {
      const notification = aNotification({aKey: 'a-value'});
      notification.alert = 'alert message';
      notification.badge = 1;
      provider.pushNotification(notification, aDeviceToken);

      const gcmArgs = mockery.firstPushNotificationArgs();

      const msg = gcmArgs[0];
      expect(msg.params.collapseKey, 'collapseKey').to.equal(undefined);
      expect(msg.params.delayWhileIdle, 'delayWhileIdle').to.equal(undefined);
      expect(msg.params.timeToLive, 'timeToLive').to.equal(undefined);
      expect(msg.params.data, 'data').to.deep.equal({
        aKey: 'a-value',
        alert: 'alert message',
        badge: 1,
      });

      expect(gcmArgs[1]).to.deep.equal([aDeviceToken]);
      done();
    });

    it('emits "error" when GCM send fails', function() {
      const anError = new Error('test-error');
      mockery.givenPushNotificationFailsWith(anError);

      const eventSpy = spyOnProviderError();

      provider.pushNotification(aNotification(), aDeviceToken);

      expect(eventSpy.calledOnce, 'error should be emitted once').to.equal(
        true
      );
      expect(eventSpy.args[0]).to.deep.equal([anError]);
    });

    it('emits "error" event when GCM returns error result', function() {
      // This is a real result returned by GCM
      const errorResult = aGcmResult([{error: 'MismatchSenderId'}]);

      mockery.pushNotificationCallbackArgs = [null, errorResult];

      const eventSpy = spyOnProviderError();

      provider.pushNotification(aNotification(), aDeviceToken);

      expect(eventSpy.calledOnce, 'error should be emitted once').to.equal(
        true
      );
      expect(eventSpy.firstCall.args[0].message).to.contain('MismatchSenderId');
    });

    it('emits "devicesGone" when GCM returns NotRegistered', function(done) {
      const errorResult = aGcmResult([{error: 'NotRegistered'}]);

      mockery.pushNotificationCallbackArgs = [null, errorResult];

      const eventSpy = sinon.spy();
      provider.on('devicesGone', eventSpy);
      provider.on('error', function(err) {
        throw err;
      });

      provider.pushNotification(aNotification(), aDeviceToken);

      const expectedIds = [aDeviceToken];
      expect(eventSpy.args[0]).to.deep.equal([expectedIds]);
      done();
    });
  });

  describe('for multiple device tokens', function() {
    it('sends Notification as a GCM message', function(done) {
      const notification = aNotification({aKey: 'a-value'});
      provider.pushNotification(notification, aDeviceTokenList);

      const gcmArgs = mockery.pushNotification.args[0];

      const msg = gcmArgs[0];
      expect(msg.params.collapseKey, 'collapseKey').to.equal(undefined);
      expect(msg.params.delayWhileIdle, 'delayWhileIdle').to.equal(undefined);
      expect(msg.params.timeToLive, 'timeToLive').to.equal(undefined);
      expect(msg.params.data, 'data').to.deep.equal({aKey: 'a-value'});

      expect(gcmArgs[1]).to.deep.equal(aDeviceTokenList);
      done();
    });

    it('handles GCM response for multiple device tokens', function(done) {
      const gcmError = new Error(
        'GCM error code: MismatchSenderId, ' +
          'deviceToken: third-device-token\nGCM error code: ' +
          'MismatchSenderId, deviceToken: fifth-device-token'
      );

      const gcmResult = aGcmResult([
        {error: 'InvalidRegistration'},
        // eslint-disable-next-line
        { message_id: '1234567890' },
        {error: 'MismatchSenderId'},
        {error: 'NotRegistered'},
        {error: 'MismatchSenderId'},
      ]);

      mockery.pushNotificationCallbackArgs = [null, gcmResult];

      const eventSpy = sinon.spy();
      provider.on('devicesGone', eventSpy);
      provider.on('error', function(err) {
        expect(err.message).to.equal(gcmError.message);
      });

      provider.pushNotification(aNotification(), aDeviceTokenList);

      const expectedIds = [aDeviceTokenList[0], aDeviceTokenList[3]];
      expect(eventSpy.calledOnce, 'error should be emitted once').to.equal(
        true
      );
      expect(eventSpy.args[0][0]).to.deep.equal(expectedIds);
      done();
    });
  });

  it('converts expirationInterval to GCM timeToLive', function() {
    const notification = aNotification({expirationInterval: 1});
    provider.pushNotification(notification, aDeviceToken);

    const message = mockery.firstPushNotificationArgs()[0];
    expect(message.params.timeToLive).to.equal(1);
  });

  it('converts expirationTime to GCM timeToLive relative to now', function() {
    const notification = aNotification({
      expirationTime: new Date(this.clock.now + 1000 /* 1 second */),
    });
    provider.pushNotification(notification, aDeviceToken);

    const message = mockery.firstPushNotificationArgs()[0];
    expect(message.params.timeToLive).to.equal(1);
  });

  it('forwards android parameters', function() {
    const notification = aNotification({
      collapseKey: 'a-collapse-key',
      delayWhileIdle: true,
    });

    provider.pushNotification(notification, aDeviceToken);

    const message = mockery.firstPushNotificationArgs()[0];
    expect(message.params.collapseKey).to.equal('a-collapse-key');
    expect(message.params.delayWhileIdle, 'delayWhileIdle').to.equal(true);
  });

  it('adds appropriate fcm properties to the notification', function() {
    const note = {
      messageFrom: 'StrongLoop',
      alert: 'Hello from StrongLoop',
      icon: 'logo.png',
      sound: 'ping.tiff',
      badge: 5,
      tag: 'alerts',
      color: '#ff0000',
      // eslint-disable-next-line
      click_action: 'OPEN_ACTIVITY_1',
    };
    const notification = aNotification(note);
    provider.pushNotification(notification, aDeviceToken);

    const message = mockery.firstPushNotificationArgs()[0];
    expect(message.params.notification).to.eql({
      title: note.messageFrom,
      body: note.alert,
      icon: note.icon,
      sound: note.sound,
      badge: note.badge,
      tag: note.tag,
      color: note.color,
      // eslint-disable-next-line
      click_action: note.click_action,
    });
  });

  it('ignores Notification properties not applicable', function() {
    const notification = aNotification(
      objectMother.allNotificationProperties()
    );
    provider.pushNotification(notification, aDeviceToken);

    const message = mockery.firstPushNotificationArgs()[0];
    expect(message.params.data).to.deep.equal({
      alert: 'an-alert',
      badge: 1230001,
    });
  });

  it('ignores Notification properties null or undefined', function() {
    const notification = aNotification({
      aFalse: false,
      aTrue: true,
      aNull: null,
      anUndefined: undefined,
    });
    provider.pushNotification(notification, aDeviceToken);

    const message = mockery.firstPushNotificationArgs()[0];
    expect(message.params.data).to.deep.equal({aFalse: false, aTrue: true});
  });

  it('supports data-only notifications', function() {
    const note = {
      messageFrom: 'StrongLoop',
      alert: 'Hello from StrongLoop',
      icon: 'logo.png',
      sound: 'ping.tiff',
      badge: 5,
      dataOnly: true,
    };
    const notification = aNotification(note);
    provider.pushNotification(notification, aDeviceToken);

    const message = mockery.firstPushNotificationArgs()[0];
    expect(message.params.data).to.eql({
      messageFrom: 'StrongLoop',
      alert: 'Hello from StrongLoop',
      title: 'StrongLoop',
      body: 'Hello from StrongLoop',
      icon: 'logo.png',
      sound: 'ping.tiff',
      badge: 5,
      dataOnly: true,
    });
  });

  function givenProviderWithConfig(pushSettings) {
    pushSettings = extend({}, pushSettings);
    pushSettings.gcm = extend({}, pushSettings.gcm);
    pushSettings.gcm.pushOptions = extend(
      {serverKey: 'a-test-server-key'},
      pushSettings.gcm.pushOptions
    );

    provider = new GcmProvider(pushSettings);
  }

  function aNotification(properties) {
    return new Notification(properties);
  }

  function aGcmResult(results) {
    const success = results.filter(function(item) {
      return item.message_id;
    }).length;

    const failure = results.filter(function(item) {
      return item.error;
    }).length;

    return {
      // eslint-disable-next-line
      multicast_id: 5504081219335647631,
      success: success,
      failure: failure,
      // eslint-disable-next-line
      canonical_ids: 0,
      results: results,
    };
  }

  function setUpFakeTimers() {
    this.clock = sinon.useFakeTimers(Date.now());
  }

  function tearDownFakeTimers() {
    this.clock.restore();
  }

  function spyOnProviderError() {
    const eventSpy = sinon.spy();
    provider.on('error', eventSpy);
    return eventSpy;
  }
});
