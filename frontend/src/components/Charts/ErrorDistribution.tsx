import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface Props {
  data: Array<{
    question_id: number;
    question_text: string;
    case_series_description?: string;
    error_rate: number;
    correct_count: number;
    incorrect_count: number;
    skip_count: number;
  }>;
}

export default function ErrorDistribution({ data }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || !data.length) return;

    const chart = echarts.init(chartRef.current);
    const labels = data.map((d) => `题${d.question_id}: ${d.question_text.slice(0, 20)}...`);
    const errorRates = data.map((d) => d.error_rate);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const d = data[params[0].dataIndex];
          return `题目: ${d.question_text}<br/>
            错误率: ${d.error_rate}%<br/>
            正确: ${d.correct_count} | 错误: ${d.incorrect_count} | 跳过: ${d.skip_count}`;
        },
      },
      grid: { left: '3%', right: '8%', bottom: '8%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { rotate: 45, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: '错误率 (%)',
        max: 100,
      },
      series: [
        {
          type: 'bar',
          data: errorRates,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#ff6b6b' },
              { offset: 1, color: '#ff4d4f' },
            ]),
            borderRadius: [4, 4, 0, 0],
          },
          label: {
            show: true,
            position: 'top',
            formatter: '{c}%',
            fontSize: 11,
          },
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
