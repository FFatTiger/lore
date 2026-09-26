import { describe, expect, it } from 'vitest';
import { SECTIONS, SETTINGS_SCHEMA } from '../settingsSchema';
import { SECTIONS_EN, SETTINGS_EN } from '../settingsSchemaEn';

const CJK = /[一-鿿]/;

describe('settings schema English copy', () => {
  it('gives every setting an English label, and a description when the Chinese one exists', () => {
    for (const def of SETTINGS_SCHEMA) {
      expect(def.label_en, def.key).toBeTruthy();
      expect(def.label_en, def.key).not.toMatch(CJK);
      if (def.description) {
        expect(def.description_en, def.key).toBeTruthy();
        expect(def.description_en, def.key).not.toMatch(CJK);
      }
    }
  });

  it('gives every section an English label and description', () => {
    for (const section of SECTIONS) {
      expect(section.label_en, section.id).toBeTruthy();
      expect(section.description_en, section.id).toBeTruthy();
      expect(`${section.label_en} ${section.description_en}`, section.id).not.toMatch(CJK);
    }
  });

  it('has no English entries for settings or sections that no longer exist', () => {
    const keys = new Set(SETTINGS_SCHEMA.map((def) => def.key));
    const sectionIds = new Set(SECTIONS.map((section) => section.id));
    expect(Object.keys(SETTINGS_EN).filter((key) => !keys.has(key))).toEqual([]);
    expect(Object.keys(SECTIONS_EN).filter((id) => !sectionIds.has(id))).toEqual([]);
  });
});
