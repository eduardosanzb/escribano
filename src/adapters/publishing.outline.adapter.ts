/**
 * Escribano - Outline Publishing Adapter
 *
 * Implements PublishingService for Outline wiki.
 */

import type { OutlineConfig, PublishingService } from '../0_types.js';

export function createOutlinePublishingService(
  config: OutlineConfig
): PublishingService {
  const baseUrl = config.url.replace(/\/$/, '');

  async function apiCall(endpoint: string, body: object) {
    const response = await fetch(`${baseUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `Outline API error: ${response.status} ${JSON.stringify(data)}`
      );
    }

    return data;
  }

  return {
    async ensureCollection(name: string) {
      const list = await apiCall('collections.list', {});
      const existing = list.data.find((c: { name: string }) => c.name === name);

      if (existing) {
        return { id: existing.id };
      }

      const created = await apiCall('collections.create', { name });
      return { id: created.data.id };
    },

    async createDocument(params) {
      const result = await apiCall('documents.create', {
        collectionId: params.collectionId,
        parentDocumentId: params.parentDocumentId,
        title: params.title,
        text: params.content,
        publish: params.publish ?? true,
      });

      return {
        id: result.data.id,
        url: `${baseUrl}/doc/${result.data.id}`,
      };
    },

    async updateDocument(id, params) {
      await apiCall('documents.update', {
        id,
        title: params.title,
        text: params.content,
      });
    },

    async findDocumentByTitle(collectionId, title) {
      // Note: Outline search or list could be used. list is safer for exact title match in collection.
      const list = await apiCall('documents.list', { collectionId });
      const doc = list.data.find((d: { title: string }) => d.title === title);

      if (doc) {
        return {
          id: doc.id,
          url: `${baseUrl}/doc/${doc.id}`,
        };
      }

      return null;
    },

    async listDocuments(collectionId) {
      const list = await apiCall('documents.list', { collectionId });
      return list.data.map(
        (d: { id: string; title: string; parentDocumentId: string }) => ({
          id: d.id,
          title: d.title,
          parentDocumentId: d.parentDocumentId,
          url: `${baseUrl}/doc/${d.id}`,
        })
      );
    },
  };
}
