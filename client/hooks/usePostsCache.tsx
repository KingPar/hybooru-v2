import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useHistory, useLocation } from "react-router";
import axios, { Canceler } from "axios";
import { PostsSearchPageData, PostsSearchRequest, PostsSearchResponse, PostSummary } from "../../server/routes/apiTypes";
import { qsParse } from "../helpers/utils";
import requestJSON from "../helpers/requestJSON";
import usePageData from "./usePageData";

export interface PostsCacheData {
  key: string | null;
  posts: PostSummary[];
  page: number;
  pageSize: number;
  total: number | null;
  tags: Record<string, number>;
  fresh: boolean;
}

const emptyPage: PostsCacheData = {
  key: null,
  posts: [],
  page: 0,
  pageSize: 1,
  total: null,
  tags: {},
  fresh: true,
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const PostsCacheContext = React.createContext<Record<string, PostsCacheData>>({});

interface PostsProviderProps {
  children: React.ReactNode;
}

export function PostsCacheProvider({ children }: PostsProviderProps) {
  const cacheRef = useRef({});
  
  return (
    <PostsCacheContext.Provider value={cacheRef.current}>
      {children}
    </PostsCacheContext.Provider>
  );
}

export default function usePostsCache() {
  const location = useLocation();
  const history = useHistory();
  const canceller = useRef<Canceler | null>(null);
  const [fetching, setFetching] = useState(false);
  const postsCache = useContext(PostsCacheContext);
  const search = qsParse(location.search);
  const query = typeof search.query === "string" ? search.query : "";
  const key = JSON.stringify([search.page, query]);
  const [pageData, pageFetching] = usePageData<PostsSearchPageData>(!postsCache[key], false);
  
  let postsCacheDefault = emptyPage;
  if(postsCache[key]) {
    postsCacheDefault = postsCache[key];
  } else if(pageData) {
    postsCacheDefault = postsCache[key] = {
      key,
      page: 1,
      tags: {},
      fresh: true,
      ...pageData.results,
    };
  }
  
  const [currentCache, setCurrentCache] = useState<PostsCacheData>(postsCacheDefault);
  
  useEffect(() => {
    if(postsCache[key] && currentCache !== postsCache[key]) {
      if(currentCache.key) {
        postsCache[currentCache.key].fresh = false;
      }
      setCurrentCache(postsCache[key]);
    }
  }, [currentCache, pageData, postsCache, key]);
  
  useEffect(() => {
    return history.listen(() => {
      if(canceller.current) canceller.current();
      canceller.current = null;
    });
  }, [history]);
  
  const requestNext = useCallback(async () => {
    if(canceller.current || pageFetching || !postsCache[key]) return;
    
    try {
      if(postsCache[key].total !== null && postsCache[key].posts.length >= (postsCache[key].total || 0)) return;
      
      setFetching(true);
      const result = await requestJSON<PostsSearchResponse, PostsSearchRequest>({
        pathname: "/api/post",
        search: {
          query,
          page: postsCache[key].page,
          blurhash: true,
        },
        cancelCb: cancel => canceller.current = cancel,
      });
      
      postsCache[key] = {
        ...postsCache[key],
        page: postsCache[key].page + 1,
        posts: [...postsCache[key].posts, ...result.posts],
        total: result.posts.length === 0 ? postsCache[key].posts.length : postsCache[key].total,
        fresh: false,
      };
      
      setCurrentCache(postsCache[key]);
    } catch(e) {
      if(!(e instanceof axios.Cancel)) throw e;
    } finally {
      canceller.current = null;
      setFetching(false);
    }
  }, [pageFetching, postsCache, key, query]);
  
  const reset = useCallback(() => {
    if(pageData) {
      postsCache[key] = {
        key,
        page: 1,
        tags: {},
        fresh: false,
        ...pageData.results,
      };
    } else {
      postsCache[key] = emptyPage;
    }
    setCurrentCache(postsCache[key]);
  }, [key, pageData, postsCache]);
  
  return { postsCache: currentCache, fetching, requestNext, reset } as const;
}
