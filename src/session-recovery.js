'use strict';
Object.assign(SW, (() => {
  const pointerKey = 'session';
  const documentKey = id => 'document:' + id;
  const backupKey = id => 'session-backup:' + id;
  const validId = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
  const tokenOf = record => record?.commit ?? null;

  function sessionMedia(project, media) {
    return new Map(Object.entries(project.assets).map(([id, asset]) => {
      const bytes = media.get(id)?.bytes;
      if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength) {
        throw Error('Missing audio: ' + asset.name);
      }
      return [id, bytes];
    }));
  }

  function validateSessionRecord(record) {
    const project = SW.validateProject(record?.snapshot);
    if (!(record.data instanceof Map) || record.data.size !== Object.keys(project.assets).length) {
      throw Error('The local Session has incomplete audio.');
    }
    for (const [id, asset] of Object.entries(project.assets)) {
      const bytes = record.data.get(id);
      if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength) throw Error('Missing audio: ' + asset.name);
    }
    return project;
  }

  function createSessionRecovery(database) {
    const observed = new Map();

    async function write(id, project, media) {
      const snapshot = SW.validateProject(project);
      const data = sessionMedia(snapshot, media);
      const commit = SW.uid();
      const db = await database();
      const expected = observed.get(id);
      await new Promise((resolve, reject) => {
        const tx = db.transaction('workspace', 'readwrite');
        const store = tx.objectStore('workspace');
        const read = store.get(documentKey(id));
        let failure;
        read.onsuccess = () => {
          const previous = read.result;
          const unobserved = previous !== undefined && !expected;
          if (unobserved || tokenOf(previous) !== (expected?.commit ?? null)) {
            failure = Error('This Session changed in another window. Save a portable copy to keep your edits.');
            tx.abort();
            return;
          }
          if (previous && !expected?.recovered) store.put(previous, backupKey(id));
          store.put({snapshot, data, commit}, documentKey(id));
          store.put({id, recoveryVersion: 1}, pointerKey);
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(failure || tx.error || Error('The local Session save was interrupted.'));
      });
      observed.set(id, {commit, recovered: false});
    }

    async function read(id) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('workspace', 'readonly');
        const store = tx.objectStore('workspace');
        let primary, backup, legacy, failure;
        function readDocument() {
          const latest = store.get(documentKey(id));
          latest.onsuccess = () => { primary = latest.result; };
          const prior = store.get(backupKey(id));
          prior.onsuccess = () => { backup = prior.result; };
        }
        if (id !== undefined) {
          readDocument();
        } else {
          const pointer = store.get(pointerKey);
          pointer.onsuccess = () => {
            const record = pointer.result;
            if (!record) return;
            id = validId(record.id) ? record.id : undefined;
            if (record.recoveryVersion === undefined) {
              legacy = record;
              if (id) readDocument();
            } else if (record.recoveryVersion === 1 && id) {
              readDocument();
            } else {
              failure = Error('This local Session uses an unsupported recovery format.');
            }
          };
        }
        tx.oncomplete = () => {
          if (failure) reject(failure);
          else if (id || legacy) resolve({id, primary, backup, legacy});
          else resolve(null);
        };
        tx.onabort = () => reject(tx.error || Error('Local Session recovery was interrupted.'));
      });
    }

    async function load(id, decode) {
      const records = await read(id);
      if (!records) return null;
      const {primary, backup, legacy} = records;
      const latest = primary ?? legacy;
      if (Number.isInteger(latest?.snapshot?.version) && latest.snapshot.version > 1) {
        throw Error('This local Session was saved by a newer version of Sonoravell.');
      }
      let failure;
      for (const [kind, record] of [['primary', latest], ['backup', backup], ['legacy', primary && legacy]]) {
        if (!record) continue;
        let project, media;
        try {
          project = validateSessionRecord(record);
          const durations = new Map(Object.entries(project.assets).map(([key, asset]) => [key, asset.duration]));
          media = await decode(record.data, durations);
        } catch (error) {
          failure = error;
          continue;
        }
        const recovered = kind !== 'primary';
        return {
          id: records.id, project, media, recovered,
          accept() {
            if (records.id) observed.set(records.id, {commit: tokenOf(primary), recovered});
          }
        };
      }
      throw failure || Error('No local recovery copy exists for this Session.');
    }

    return {write, load};
  }

  return {createSessionRecovery};
})());
