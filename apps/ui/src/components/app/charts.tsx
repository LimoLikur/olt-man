import { BarChart as EBarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef } from 'react';
import { day, shortDateTime, time } from '../../format';
import { RX_CRITICAL, RX_WARNING } from '../../signal';

echarts.use([LineChart, EBarChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer]);

/** Hex equivalents of the oklch tokens in styles.css: zrender cannot parse oklch(). */
export const CHART_COLORS = {
  primary: '#6e47dd',
  orange: '#f37513',
  success: '#02a05e',
  info: '#3284d0',
  warning: '#edae12',
  critical: '#e0383b',
  muted: '#686871',
  border: '#e2e2e6',
  foreground: '#15151b',
} as const;

const FONT = "'Geist Variable', ui-sans-serif, system-ui, sans-serif";

/** Canvas chart (CSP-safe: no injected <style>), resized with its container. */
function EChart({ option, className, testId, points }: { option: echarts.EChartsCoreOption; className: string; testId?: string; points?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current);
    chart.current = c;
    const resize = new ResizeObserver(() => c.resize());
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);
  return <div ref={el} className={className} data-testid={testId} data-points={points} />;
}

export interface RxPoint {
  ts: string;
  rxDbm: number | null;
  oltRxDbm: number | null;
}

const axisText = { color: CHART_COLORS.muted, fontSize: 11, fontFamily: FONT };
const dashedGrid = { lineStyle: { type: [3, 4] as number[], color: CHART_COLORS.border } };

/** ONU Rx (area) and OLT Rx (line) over time, with the -25 / -27 dBm thresholds (SPEC §8.2). */
export function RxChart({ points, range }: { points: RxPoint[]; range: '24h' | '7d' }) {
  const option = useMemo<echarts.EChartsCoreOption>(
    () => ({
      animation: false,
      textStyle: { fontFamily: FONT },
      grid: { left: 44, right: 12, top: 32, bottom: 28 },
      legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: axisText, data: ['ONU Rx', 'OLT Rx'] },
      tooltip: {
        trigger: 'axis',
        textStyle: { fontFamily: FONT, fontSize: 12 },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(2)} dBm` : '—'),
        axisPointer: { label: { formatter: (p: { value: number }) => shortDateTime(new Date(p.value).toISOString()) } },
      },
      xAxis: {
        type: 'time',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { ...axisText, hideOverlap: true, formatter: (v: number) => (range === '24h' ? time : day)(new Date(v).toISOString()) },
      },
      // Like the design: the axis always reaches below the critical line, so both thresholds show.
      yAxis: {
        type: 'value',
        min: (v: { min: number }) => Math.min(Math.floor(v.min) - 1, RX_CRITICAL - 2),
        max: (v: { max: number }) => Math.ceil(v.max) + 1,
        axisLabel: axisText,
        splitLine: dashedGrid,
      },
      series: [
        {
          name: 'ONU Rx',
          type: 'line',
          smooth: true,
          showSymbol: points.length < 50,
          symbolSize: 4,
          connectNulls: false,
          lineStyle: { width: 2, color: CHART_COLORS.primary },
          itemStyle: { color: CHART_COLORS.primary },
          areaStyle: {
            origin: 'start',
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(110, 71, 221, 0.25)' },
              { offset: 1, color: 'rgba(110, 71, 221, 0)' },
            ]),
          },
          data: points.map((p) => [p.ts, p.rxDbm]),
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            data: [
              { yAxis: RX_WARNING, lineStyle: { color: CHART_COLORS.warning, type: [5, 5], width: 1.5 } },
              { yAxis: RX_CRITICAL, lineStyle: { color: CHART_COLORS.critical, type: [5, 5], width: 1.5 } },
            ],
          },
        },
        {
          name: 'OLT Rx',
          type: 'line',
          smooth: true,
          showSymbol: points.length < 50,
          symbolSize: 4,
          connectNulls: false,
          lineStyle: { width: 1.5, color: CHART_COLORS.orange },
          itemStyle: { color: CHART_COLORS.orange },
          data: points.map((p) => [p.ts, p.oltRxDbm]),
        },
      ],
    }),
    [points, range],
  );
  return <EChart option={option} className="h-[300px] w-full" testId="rx-chart" points={points.length} />;
}

/** Vertical bars, one colour per bar. */
export function BarChart({ data, height = 'h-[180px]' }: { data: { label: string; value: number; color: string }[]; height?: string }) {
  const option = useMemo<echarts.EChartsCoreOption>(
    () => ({
      animation: false,
      textStyle: { fontFamily: FONT },
      grid: { left: 36, right: 8, top: 10, bottom: 24 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, textStyle: { fontFamily: FONT, fontSize: 12 } },
      xAxis: { type: 'category', data: data.map((d) => d.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...axisText, interval: 0 } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: axisText, splitLine: dashedGrid },
      series: [{ name: 'ONUs', type: 'bar', barMaxWidth: 40, data: data.map((d) => ({ value: d.value, itemStyle: { color: d.color, borderRadius: [4, 4, 0, 0] } })) }],
    }),
    [data],
  );
  return <EChart option={option} className={`${height} w-full`} />;
}
