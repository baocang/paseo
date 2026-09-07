import { afterEach, describe, expect, it } from "vitest";
import {
  buildElementSelectorScript,
  type BrowserElementSelection,
} from "./element-selector.electron";

interface SelectorWindow extends Window {
  __paseoSelector: { destroy: () => void };
  __paseoSelectorResult: BrowserElementSelection | null;
}

function fixtureElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  expect(element, `Fixture element ${selector}`).not.toBeNull();
  return element!;
}

function selectedSelector(guest: SelectorWindow): string {
  const selector = guest.__paseoSelectorResult?.selector;
  expect(selector).toEqual(expect.any(String));
  expect(selector).not.toBe("");
  return selector!;
}

async function selectElement(element: HTMLElement): Promise<void> {
  element.click();
  // Let browser checkbox/radio default-action rollback finish before reading state.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function mountFixture(html: string): SelectorWindow {
  document.body.innerHTML = html;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [...document.body.querySelectorAll("[data-hit]")].toReversed(),
  });
  window.eval(buildElementSelectorScript("browser-test"));
  return window as unknown as SelectorWindow;
}

function pointerEvent(type: string, input: { y: number; pointerId: number }): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: input.y,
    pointerId: input.pointerId,
    pointerType: "touch",
  });
}

afterEach(() => {
  (window as unknown as Partial<SelectorWindow>).__paseoSelector?.destroy();
  document.body.replaceChildren();
});

describe("element selector guest script", () => {
  it.each([
    ["missing CSS", undefined],
    ["missing escape", {}],
    ["replaced escape", { escape: () => "wrong-selector" }],
    [
      "throwing escape",
      {
        escape: () => {
          throw new Error("Page replaced CSS.escape");
        },
      },
    ],
  ])("selects a special ID with %s", async (_label, pageCss) => {
    const originalCss = Object.getOwnPropertyDescriptor(window, "CSS");
    expect(originalCss).toEqual(expect.objectContaining({ configurable: true }));
    try {
      Object.defineProperty(window, "CSS", { configurable: true, value: pageCss });
      const guest = mountFixture(
        '<button id=":r0:" data-hit style="width:100px;height:40px">Target</button>',
      );
      const button = fixtureElement("[data-hit]");

      await selectElement(button);

      const selector = selectedSelector(guest);
      expect(document.querySelectorAll(selector)).toHaveLength(1);
      expect(document.querySelector(selector)).toBe(button);
    } finally {
      Object.defineProperty(window, "CSS", originalCss!);
    }
  });

  it.each([
    ":r0:",
    "123",
    "panel.title",
    "-",
    "-1",
    'quoted"id',
    "space id",
    "slash\\id",
    "\u{1f600}",
  ])("escapes the selected ID %s", async (id) => {
    const guest = mountFixture('<button data-hit style="width:100px;height:40px">Target</button>');
    const button = fixtureElement("button");
    button.id = id;

    await selectElement(button);

    const selector = selectedSelector(guest);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(button);
  });

  it("uniquely locates a first child under a duplicated ancestor ID", async () => {
    const guest = mountFixture(`
      <section id="duplicate"><button id="same" data-hit>Target</button><button>Other</button></section>
      <section id="duplicate"><button id="same">Elsewhere</button></section>
    `);
    const button = fixtureElement<HTMLButtonElement>("[data-hit]");

    await selectElement(button);

    const selector = selectedSelector(guest);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(button);
  });

  it.each([false, true])("captures the original checkbox state %s", async (checked) => {
    const guest = mountFixture('<input type="checkbox" data-hit>');
    const checkbox = fixtureElement<HTMLInputElement>("input");
    checkbox.checked = checked;

    await selectElement(checkbox);

    expect(checkbox.checked).toBe(checked);
    expect(guest.__paseoSelectorResult?.runtimeProperties?.checked).toBe(checked);
  });

  it("captures an unchecked radio without changing its group selection", async () => {
    const guest = mountFixture(`
      <input id="original" type="radio" name="choice" checked>
      <input id="target" type="radio" name="choice" data-hit>
    `);
    const original = fixtureElement<HTMLInputElement>("#original");
    const target = fixtureElement<HTMLInputElement>("#target");

    await selectElement(target);

    expect(original.checked).toBe(true);
    expect(target.checked).toBe(false);
    expect(guest.__paseoSelectorResult?.runtimeProperties?.checked).toBe(false);
  });

  it("skips invisible targets and keeps the selected element highlighted", async () => {
    const guest = mountFixture(`
      <button id="repair" data-hit style="width:120px;height:40px">Repair</button>
      <div id="overlay" data-hit style="opacity:0"><button id="ghost">Hidden</button></div>
    `);
    const button = fixtureElement("#repair");

    await selectElement(button);

    expect(guest.__paseoSelectorResult?.selector).toBe("#repair");
    expect(button.classList.contains("__paseo-selected")).toBe(true);
    guest.__paseoSelector.destroy();
    expect(button.classList.contains("__paseo-selected")).toBe(false);
  });

  it("extracts typography and leaf-text metadata", async () => {
    const guest = mountFixture(`
      <p id="leaf" data-hit style="font: 600 18px Inter; color: rgb(10, 20, 30)">Leaf</p>
    `);
    const leaf = fixtureElement("#leaf");

    await selectElement(leaf);

    expect(guest.__paseoSelectorResult?.computedStyles).toMatchObject({
      "font-size": "18px",
      "font-weight": "600",
    });
    expect(guest.__paseoSelectorResult?.runtimeProperties?.hasChildElements).toBe(false);
  });

  it("selects a tap without cancelling its pointerdown default", async () => {
    const guest = mountFixture(
      '<button id="mobile-action" data-hit style="width:100px;height:44px">Submit</button>',
    );
    const button = fixtureElement("#mobile-action");
    const down = pointerEvent("pointerdown", { y: 40, pointerId: 7 });
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    button.dispatchEvent(down);
    button.dispatchEvent(pointerEvent("pointerup", { y: 40, pointerId: 7 }));
    await selectElement(button);

    expect(down.defaultPrevented).toBe(false);
    expect(guest.__paseoSelectorResult?.selector).toBe("#mobile-action");
    expect(clickCount).toBe(0);
  });

  it("leaves drag defaults available and suppresses the following click", async () => {
    const guest = mountFixture(
      '<button id="mobile-action" data-hit style="width:100px;height:44px">Submit</button>',
    );
    const button = fixtureElement("#mobile-action");
    const move = pointerEvent("pointermove", { y: 70, pointerId: 11 });

    button.dispatchEvent(pointerEvent("pointerdown", { y: 40, pointerId: 11 }));
    button.dispatchEvent(move);
    button.dispatchEvent(pointerEvent("pointerup", { y: 70, pointerId: 11 }));
    await selectElement(button);

    expect(move.defaultPrevented).toBe(false);
    expect(guest.__paseoSelectorResult).toBeNull();
  });
});
