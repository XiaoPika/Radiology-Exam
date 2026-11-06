import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface Props {
  data: Array<{
    user_name: string;
    department?: string;
    percentage: number;
    score: number;
    total: number;
    duration_minutes: number;
  }>;
}

export default function ScoreRanking({ data }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || !data.length) return;

    const chart = echarts.init(chartRef.current);
    // Sort descending by percentage, take top 20
    const sorted = [...data].sort((a, b) => b.percentage - a.percentage).slice(0, 20);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const d = sorted[params[0].dataIndex];
          return `${d.user_name} (${d.department || '无部门'})<br/>
            成绩: ${d.percentage.toFixed(1)}% (${d.score}/${d.total})<br/>
            用时: ${d.duration_minutes}分钟`;
        },
      },
      grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value', name: '正确率 (%)', max: 100 },
      yAxis: {
        type: 'category',
        data: sorted.map((d) => d.user_name).reverse(),
        inverse: true,
        axisLabel: { fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.percentage).reverse(),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: '#1677ff' },
              { offset: 1, color: '#69c0ff' },
            ]),
            borderRadius: [0, 4, 4, 0],
          },
          label: { show: true, position: 'right', formatter: '{c}%', fontSize: 11 },
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
    };
  }, [data]);

  if (!data.length) return <p style={{ textAlign: 'center', color: '#999', padding: 40 }}>暂无数据</p>;

  return <div ref={chartRef} style={{ width: '100%', height: '300px' }} />;
}
