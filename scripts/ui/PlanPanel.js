import { MODULE_ID } from '../constants.js';
import { baseActor, getOrDraftPlan, setPlan } from '../stores/hazardStore.js';
import { formToPlan, nextId, planToContext } from './planForm.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PlanPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'hazarder-plan-{id}',
    classes: ['hazarder-plan'],
    tag: 'form',
    window: { resizable: true },
    position: { width: 560, height: 'auto' },
    form: { handler: PlanPanel.#onSubmit, closeOnSubmit: true },
    actions: {
      addComponent: PlanPanel.#addComponent,
      addDisable: PlanPanel.#addDisable,
      removeComponent: PlanPanel.#removeComponent,
      removeDisable: PlanPanel.#removeDisable,
    },
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/plan-panel.hbs` } };

  static open(actor) {
    return new Promise((resolve) => new PlanPanel({ actor, resolve }).render(true));
  }

  constructor({ actor, resolve, ...options }) {
    super(options);
    this.actor = baseActor(actor);
    this.resolve = resolve;
    const { plan, warnings } = getOrDraftPlan(actor);
    this.plan = plan;
    this.warnings = warnings;
    this.saved = null;
  }

  get title() {
    return game.i18n.format('PF2E_HAZARDER.Plan.Title', { name: this.actor.name });
  }

  async _prepareContext() {
    return planToContext(this.plan, this.warnings, this.actor);
  }

  /** Fold current field values into this.plan, keeping blank rows so freshly added rows survive. */
  #foldForm() {
    const data = foundry.utils.expandObject(
      new foundry.applications.ux.FormDataExtended(this.element).object,
    );
    this.plan = {
      ...formToPlan(data, this.plan, { keepBlank: true }),
      confirmed: this.plan.confirmed,
    };
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    this.saved = formToPlan(data, this.plan);
    await setPlan(this.actor, this.saved);
  }

  static #addComponent() {
    this.#foldForm();
    this.plan.components.push({
      id: nextId('c', this.plan.components),
      name: '',
      count: 1,
      actionsEach: 0,
      disables: [],
      counteract: null,
    });
    this.render();
  }

  static #addDisable(event, target) {
    this.#foldForm();
    const comp = this.plan.components[Number(target.dataset.component)];
    comp.disables.push({
      id: nextId('d', comp.disables),
      skill: '',
      dc: null,
      label: '',
      traits: [],
      successesNeeded: 1,
    });
    this.render();
  }

  static #removeComponent(event, target) {
    this.#foldForm();
    this.plan.components.splice(Number(target.dataset.component), 1);
    this.render();
  }

  static #removeDisable(event, target) {
    this.#foldForm();
    const comp = this.plan.components[Number(target.dataset.component)];
    comp?.disables.splice(Number(target.dataset.disable), 1);
    this.render();
  }

  _onClose(options) {
    super._onClose(options);
    this.resolve?.(this.saved);
  }
}
