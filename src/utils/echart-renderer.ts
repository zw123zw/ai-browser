/**
 * ECharts 图表渲染器
 *
 * 功能：
 * - 动态加载 ECharts（按需导入，不增加首屏体积）
 * - 渲染图表到 DOM 容器
 * - 导出图表为 PNG 图片
 * - 解析 .chart 配置文件
 */

import type { EChartsOption, ECharts as EChartsInstance } from 'echarts';

// ============ 类型定义 ============

/** 图表配置接口 */
export interface ChartConfig {
  /** ECharts 配置项 */
  option: EChartsOption;
  /** 图表宽度，默认 800 */
  width?: number;
  /** 图表高度，默认 500 */
  height?: number;
  /** 主题：'light' | 'dark' | 自定义主题名 */
  theme?: string;
}

/** 图表渲染结果 */
export interface ChartRenderResult {
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
  /** 清理函数 */
  dispose?: () => void;
  /** ECharts 实例 */
  chart?: any;
}

// ============ ECharts 动态加载 ============

/** ECharts 模块缓存 */
let echartsModule: typeof import('echarts') | null = null;
let echartsLoadPromise: Promise<typeof import('echarts')> | null = null;

/**
 * 动态加载 ECharts
 * 使用动态 import 按需加载，避免增加首屏包体积
 */
export async function loadECharts(): Promise<typeof import('echarts')> {
  if (echartsModule) {
    return echartsModule;
  }

  if (echartsLoadPromise) {
    return echartsLoadPromise;
  }

  echartsLoadPromise = import('echarts').then(module => {
    echartsModule = module;
    return module;
  });

  return echartsLoadPromise;
}

/**
 * 检查 ECharts 是否已加载
 */
export function isEChartsLoaded(): boolean {
  return echartsModule !== null;
}

// ============ 图表配置解析 ============

/**
 * 解析 .chart 文件内容为 ChartConfig
 *
 * 支持两种格式：
 * 1. 完整格式：{ "option": {...}, "width": 800, "height": 500 }
 * 2. 简化格式：直接是 option 对象（向后兼容）
 *
 * @param content .chart 文件内容（JSON 字符串）
 * @returns ChartConfig 或 null（解析失败）
 */
export function parseChartConfig(content: string): ChartConfig | null {
  try {
    const parsed = JSON.parse(content);

    // 验证是否为有效对象
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    // 完整格式：包含 option 字段
    if (parsed.option && typeof parsed.option === 'object') {
      return {
        option: parsed.option,
        width: typeof parsed.width === 'number' ? parsed.width : 800,
        height: typeof parsed.height === 'number' ? parsed.height : 500,
        theme: typeof parsed.theme === 'string' ? parsed.theme : undefined,
      };
    }

    // 简化格式：整个对象就是 option（向后兼容）
    // 验证是否包含必要的 ECharts 配置字段
    if (parsed.series || parsed.xAxis || parsed.yAxis || parsed.radar || parsed.tooltip) {
      return {
        option: parsed,
        width: 800,
        height: 500,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 验证 ChartConfig 是否有效
 * @param config 图表配置
 */
export function validateChartConfig(config: ChartConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.option) {
    errors.push('缺少 option 配置');
  }

  if (config.width && (config.width < 100 || config.width > 4096)) {
    errors.push('宽度应在 100-4096 之间');
  }

  if (config.height && (config.height < 100 || config.height > 4096)) {
    errors.push('高度应在 100-4096 之间');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============ 图表渲染 ============

/**
 * 在指定 DOM 容器中渲染图表
 *
 * @param container DOM 容器元素
 * @param config 图表配置
 * @returns 渲染结果，包含清理函数
 */
export async function renderChartToElement(
  container: HTMLElement,
  config: ChartConfig
): Promise<ChartRenderResult> {
  try {
    const echarts = await loadECharts();

    // 初始化图表，不传固定尺寸，让 ECharts 自动使用容器尺寸
    const chart = echarts.init(container, config.theme, {
      renderer: 'canvas',
    });

    // 设置配置项
    chart.setOption(config.option, true);

    // 返回清理函数
    const dispose = () => {
      chart.dispose();
    };

    return { success: true, dispose, chart };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '图表渲染失败',
    };
  }
}

/**
 * 渲染图表为 Canvas 元素（离屏渲染）
 *
 * @param config 图表配置
 * @returns Canvas 元素
 */
export async function renderChartToCanvas(config: ChartConfig): Promise<HTMLCanvasElement> {
  const echarts = await loadECharts();

  const width = config.width || 800;
  const height = config.height || 500;

  // 创建离屏 Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width * 2; // 2x 分辨率
  canvas.height = height * 2;

  // 使用 Canvas 渲染器初始化
  const chart = echarts.init(canvas, config.theme, {
    renderer: 'canvas',
    width,
    height,
    devicePixelRatio: 2,
  });

  chart.setOption(config.option, true);

  // 等待渲染完成
  await new Promise<void>(resolve => {
    setTimeout(() => {
      chart.dispose();
      resolve();
    }, 100);
  });

  return canvas;
}

/**
 * 渲染图表为 PNG Blob
 *
 * @param config 图表配置
 * @param pixelRatio 像素比，默认 2（高清）
 * @param backgroundColor 背景颜色，默认白色
 * @returns PNG Blob
 */
export async function renderChartToBlob(
  config: ChartConfig,
  pixelRatio = 2,
  backgroundColor = '#ffffff'
): Promise<Blob> {
  const echarts = await loadECharts();

  const width = config.width || 800;
  const height = config.height || 500;

  // 创建临时容器（ECharts 需要 DOM 元素）
  const container = document.createElement('div');
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.visibility = 'hidden';
  document.body.appendChild(container);

  try {
    // 初始化图表
    const chart = echarts.init(container, config.theme, {
      renderer: 'canvas',
      width,
      height,
    });

    chart.setOption(config.option, true);

    // 等待渲染完成
    await new Promise<void>(resolve => setTimeout(resolve, 200));

    // 导出为图片
    const dataUrl = chart.getDataURL({
      type: 'png',
      pixelRatio,
      backgroundColor,
    });

    chart.dispose();

    // 转为 Blob
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: 'image/png' });
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * 渲染图表为 SVG 字符串
 *
 * @param config 图表配置
 * @returns SVG 字符串
 */
export async function renderChartToSvg(config: ChartConfig): Promise<string> {
  const echarts = await loadECharts();

  const width = config.width || 800;
  const height = config.height || 500;

  // 创建临时容器
  const container = document.createElement('div');
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.visibility = 'hidden';
  document.body.appendChild(container);

  try {
    // 使用 SVG 渲染器
    const chart = echarts.init(container, config.theme, {
      renderer: 'svg',
      width,
      height,
    });

    chart.setOption(config.option, true);

    // 等待渲染完成
    await new Promise<void>(resolve => setTimeout(resolve, 200));

    // 获取 SVG 内容
    const svgElement = container.querySelector('svg');
    const svgString = svgElement ? new XMLSerializer().serializeToString(svgElement) : '';

    chart.dispose();

    return svgString;
  } finally {
    document.body.removeChild(container);
  }
}

// ============ 常用图表配置模板 ============

/** 创建柱状图配置 */
export function createBarChartConfig(
  title: string,
  categories: string[],
  data: number[],
  options?: Partial<ChartConfig>
): ChartConfig {
  return {
    option: {
      title: { text: title, left: 'center' },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: categories,
      },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'bar',
          data,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
          },
        },
      ],
    },
    width: options?.width || 800,
    height: options?.height || 500,
    ...options,
  };
}

/** 创建折线图配置 */
export function createLineChartConfig(
  title: string,
  categories: string[],
  datasets: Array<{ name: string; data: number[] }>,
  options?: Partial<ChartConfig>
): ChartConfig {
  return {
    option: {
      title: { text: title, left: 'center' },
      tooltip: { trigger: 'axis' },
      legend: {
        data: datasets.map(d => d.name),
        bottom: 0,
      },
      xAxis: {
        type: 'category',
        data: categories,
        boundaryGap: false,
      },
      yAxis: { type: 'value' },
      series: datasets.map(d => ({
        name: d.name,
        type: 'line' as const,
        data: d.data,
        smooth: true,
      })),
    },
    width: options?.width || 800,
    height: options?.height || 500,
    ...options,
  };
}

/** 创建饼图配置 */
export function createPieChartConfig(
  title: string,
  data: Array<{ name: string; value: number }>,
  options?: Partial<ChartConfig> & { doughnut?: boolean }
): ChartConfig {
  const isDoughnut = options?.doughnut ?? false;

  return {
    option: {
      title: { text: title, left: 'center' },
      tooltip: {
        trigger: 'item',
        formatter: '{a} <br/>{b}: {c} ({d}%)',
      },
      legend: {
        orient: 'vertical',
        left: 'left',
      },
      series: [
        {
          name: title,
          type: 'pie',
          radius: isDoughnut ? ['40%', '70%'] : '50%',
          data,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
        },
      ],
    },
    width: options?.width || 800,
    height: options?.height || 500,
    theme: options?.theme,
  };
}

/** 创建雷达图配置 */
export function createRadarChartConfig(
  title: string,
  indicators: Array<{ name: string; max: number }>,
  datasets: Array<{ name: string; value: number[] }>,
  options?: Partial<ChartConfig>
): ChartConfig {
  return {
    option: {
      title: { text: title, left: 'center' },
      tooltip: {},
      legend: {
        data: datasets.map(d => d.name),
        bottom: 0,
      },
      radar: {
        indicator: indicators,
      },
      series: [
        {
          type: 'radar',
          data: datasets.map(d => ({
            name: d.name,
            value: d.value,
          })),
        },
      ],
    },
    width: options?.width || 800,
    height: options?.height || 500,
    ...options,
  };
}

// ============ 工具函数 ============

/**
 * 获取 ECharts 版本
 */
export async function getEChartsVersion(): Promise<string> {
  const echarts = await loadECharts();
  return echarts.version || 'unknown';
}

/**
 * 预加载 ECharts（可在空闲时调用，减少首次渲染延迟）
 */
export function preloadECharts(): void {
  loadECharts().catch(() => {
    // 静默失败，不影响主流程
  });
}
