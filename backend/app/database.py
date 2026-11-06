import asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Create all tables if they don't exist, with retry logic for docker startup."""
    import app.models  # noqa: F401
    max_retries = 15
    retry_delay = 2
    for attempt in range(1, max_retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            print("[database] Database tables initialized successfully.")
            return
        except Exception as e:
            if attempt == max_retries:
                print(f"[database] Failed to connect to database after {max_retries} attempts: {e}")
                raise
            print(f"[database] Waiting for database connection (attempt {attempt}/{max_retries}): {e}")
            await asyncio.sleep(retry_delay)
