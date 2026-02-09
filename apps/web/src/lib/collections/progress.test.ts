/**
 * Progress Collection Tests
 *
 * Tests for the localStorage-backed progress collection.
 */

import { describe, expect, it } from 'vitest';
import {
  clearAllProgress,
  clearProgress,
  getProgress,
  mergeServerProgress,
  progressCollection,
  syncProgressToServer,
  updateLocalProgress,
} from './progress';

describe('collections/progress', () => {
  describe('progressCollection', () => {
    it('is defined', () => {
      expect(progressCollection).toBeDefined();
    });

    it('has a state property (TanStack DB collection)', () => {
      expect(progressCollection.state).toBeDefined();
    });

    it('has insert method', () => {
      expect(typeof progressCollection.insert).toBe('function');
    });

    it('has update method', () => {
      expect(typeof progressCollection.update).toBe('function');
    });

    it('has delete method', () => {
      expect(typeof progressCollection.delete).toBe('function');
    });
  });

  describe('updateLocalProgress', () => {
    it('is defined and callable', () => {
      expect(updateLocalProgress).toBeDefined();
      expect(typeof updateLocalProgress).toBe('function');
    });

    it('accepts contentId, positionSeconds, and durationSeconds', () => {
      expect(updateLocalProgress.length).toBe(3);
    });
  });

  describe('syncProgressToServer', () => {
    it('is defined and callable', () => {
      expect(syncProgressToServer).toBeDefined();
      expect(typeof syncProgressToServer).toBe('function');
    });

    it('returns a Promise', () => {
      // Should return a Promise (async function)
      const result = syncProgressToServer();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('mergeServerProgress', () => {
    it('is defined and callable', () => {
      expect(mergeServerProgress).toBeDefined();
      expect(typeof mergeServerProgress).toBe('function');
    });

    it('accepts contentId', () => {
      expect(mergeServerProgress.length).toBe(1);
    });
  });

  describe('getProgress', () => {
    it('is defined and callable', () => {
      expect(getProgress).toBeDefined();
      expect(typeof getProgress).toBe('function');
    });

    it('accepts contentId', () => {
      expect(getProgress.length).toBe(1);
    });

    it('returns null for non-existent content', () => {
      const result = getProgress('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('clearProgress', () => {
    it('is defined and callable', () => {
      expect(clearProgress).toBeDefined();
      expect(typeof clearProgress).toBe('function');
    });

    it('accepts contentId', () => {
      expect(clearProgress.length).toBe(1);
    });
  });

  describe('clearAllProgress', () => {
    it('is defined and callable', () => {
      expect(clearAllProgress).toBeDefined();
      expect(typeof clearAllProgress).toBe('function');
    });

    it('accepts no arguments', () => {
      expect(clearAllProgress.length).toBe(0);
    });
  });
});
