import deepMerge from "deepmerge";
import { debounce, loadAsyncImage, throttle } from "../libs/utils";
import animationMap from "../animations/index";
import { options as defaultOptions } from "./default";
import { EventEmitter } from "../libs/eventEmitter";
import type { TOptions, TDataSource } from "./types";

export default class Waterfall extends EventEmitter {
  private isLoadingImage = false;
  private options: TOptions;
  private items: HTMLElement[] = []; //存储子元素
  private itemHeight: number[] = []; //每列的高度
  private eventStore: any = {};

  constructor(options: TOptions) {
    super();

    this.options = deepMerge(defaultOptions, options);
    this.init();
  }

  private init = async () => {
    const { resizable, initialData = [], column } = this.options;
    if (typeof this.options.container === "string") {
      if (
        !this.options.container.startsWith(".") &&
        !this.options.container.startsWith("#")
      ) {
        throw new Error(
          `请按照标准的 DOM 查询条件传入，如'.container' 或 '#container'`
        );
      }

      this.options.container = document.querySelector<HTMLElement>(
        this.options.container
      );
    }

    if (!this.options.container) {
      throw new Error("container实例不存在，请检查");
    }

    (this.options.container as HTMLElement).style.overflowX = "hidden";
    this.itemHeight = new Array(column).fill(0);
    (this.options.container as HTMLElement).style.position = "relative";
    resizable && this.resize();
    this.initImage(initialData);
    this.onTouchBottom();
  };

  private initImage = async (dataSource: TDataSource[]) => {
    this.isLoadingImage = true;
    const containerChildrens = await this.createContent(dataSource);
    this.items = this.items.concat(containerChildrens);
    this.computePosition(containerChildrens);
    this.isLoadingImage = false;
  };

  private createContent = async (dataSource: TDataSource[] = []) => {
    const {
      onClick,
      imgClass,
      imgContainerClass,
      bottomContainerClass,
      render,
      defaultImgUrl = "",
    } = this.options;
    const res = await Promise.allSettled(
      dataSource.map((data) => data?.src && loadAsyncImage(data.src))
    );
    const containerChildrens: HTMLElement[] = [];
    const fragment = document.createDocumentFragment();

    for (let [index, data] of dataSource.entries()) {
      const div = document.createElement("div");
      div.className = imgContainerClass!;
      if (data?.src) {
        const img = document.createElement("img");
        img.style.verticalAlign = "bottom";
        img.src = data.src;
        if (res[index].status === "rejected") {
          try {
            const defaultImg = await loadAsyncImage(defaultImgUrl);
            img.src = defaultImg.src;
          } catch (e) {
            console.error(`该默认图片加载失败：${defaultImgUrl}, ${e}`);
          }
        }
        img.alt = data?.alt || "image";
        img.className = imgClass!;
        div.appendChild(img);
      }
      if (render) {
        const bottomBox = document.createElement("div");
        bottomBox.className = bottomContainerClass!;
        bottomBox.innerHTML = render(data);
        div.appendChild(bottomBox);
      }

      div.onclick = (e) => {
        onClick?.(data, e);
      };
      containerChildrens.push(div);
      fragment.appendChild(div);
    }
    (this.options.container as HTMLElement).appendChild(fragment);

    return containerChildrens;
  };

  private computePosition = (
    containerChildrens: HTMLElement[],
    isResize: boolean = true
  ) => {
    requestAnimationFrame(() => {
      let {
        options: {
          gapX,
          gapY,
          column,
          width,
          bottomContainerClass,
          render,
          animation,
        },
      } = this;
      width =
        width || (this.options.container as HTMLElement).clientWidth / column!;

      isResize && (this.itemHeight = new Array(column).fill(0));

      for (let item of containerChildrens) {
        if (animation!.name !== "none") {
          item.style.opacity = "0";
          item.style.transform = animationMap[animation!.name!].start;
        }
        const img = item.querySelector("img");
        if (img) {
          img.style.width = width + "px";
        }
        let imgContainerHeight: number;
        item.style.width = width + "px";
        item.style.position = "absolute";
        // 兼容没有传入图片src的模式
        if (render) {
          const bottomContainer = item.querySelector(
            `.${bottomContainerClass}`
          ) as HTMLElement;
          bottomContainer.style.width = width + "px";
          if (img) {
            imgContainerHeight =
              (img?.height || 30) + (bottomContainer?.clientHeight || 0);
          } else {
            imgContainerHeight = bottomContainer?.clientHeight || 0;
          }
        } else {
          imgContainerHeight = img?.height || 0;
        }

        let idx = this.itemHeight.indexOf(Math.min(...this.itemHeight)); //找到高度最小的元素的下标
        item.style.left = idx * (width! + gapX!) + "px";
        item.style.top = this.itemHeight[idx] + "px";
        this.itemHeight[idx] += Math.round(
          (imgContainerHeight! * width!) / width! + gapY!
        );

        if (animation!.name !== "none") {
          item.style.transition = `transform ${animation!.duration}s ease`;
          item.style.opacity = "1";
          item.style.transform = animationMap[animation!.name!].end;
        }
      }

      this.refreshContainerHeight();
    });
  };

  private refreshContainerHeight = () => {
    const max = Math.max(...this.itemHeight);
    (this.options.container as HTMLElement).style.height = max + "px";
  };

  private resize = () => {
    window.addEventListener(
      "resize",
      (this.eventStore.throttleResize = throttle(() => {
        this.computePosition(this.items, true);
      }))
    );
  };

  /** 触底时的回调函数 */
  private onTouchBottom = () => {
    const { bottomDistance = 100, onReachBottom } = this.options;
    if (bottomDistance < 100) {
      console.error("bottomDistance，触底事件离底部触发的距离不能小于100");
      return;
    }

    window.addEventListener(
      "scroll",
      (this.eventStore.debounceScroll = debounce(() => {
        const { clientHeight, scrollTop, scrollHeight } =
          document.documentElement;
        if (clientHeight + scrollTop + bottomDistance >= scrollHeight) {
          if (this.isLoadingImage) return;
          this.emit("onTouchBottom");
          onReachBottom?.();
        }
      }))
    );
  };

  /** 触底加载更多 */
  loadMore = async (dataSource: TDataSource[]) => {
    this.on("onTouchBottom", () => {
      this.initImage(dataSource);
    });
  };

  /** 销毁监听的scroll事件和resize事件 */
  destroy = () => {
    window.removeEventListener("resize", this.eventStore.throttleResize);
    window.removeEventListener("scroll", this.eventStore.debounceScroll);
  };
}
