import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface Props {
  data: Array<{
    range_label: string;
    count: number;
  }>;
}

export default function TimeAnalysis({ data }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || !data.length) return;

    const chart = echarts.init(chartRef.current);

    chart.setOption({
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'pie',
          radius: ['50%', '75%'],
          center: ['50%', '55%'],
          data: data.map((d) => ({
            name: d.range_label,
            value: d.count,
          })),
          label: {
            formatter: '{b}\n{d}%',
            fontSize: 12,
          },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.3)' },
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
