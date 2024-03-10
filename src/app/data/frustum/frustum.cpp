#include "frustum.hpp"

namespace NugieApp
{
  void Frustum::setFromViewProjection(const glm::mat4 &mvp) {
    planes[LEFT].x = mvp[0].w + mvp[0].x;
    planes[LEFT].y = mvp[1].w + mvp[1].x;
    planes[LEFT].z = mvp[2].w + mvp[2].x;
    planes[LEFT].w = mvp[3].w + mvp[3].x;

    planes[RIGHT].x = mvp[0].w - mvp[0].x;
    planes[RIGHT].y = mvp[1].w - mvp[1].x;
    planes[RIGHT].z = mvp[2].w - mvp[2].x;
    planes[RIGHT].w = mvp[3].w - mvp[3].x;

    planes[TOP].x = mvp[0].w - mvp[0].y;
    planes[TOP].y = mvp[1].w - mvp[1].y;
    planes[TOP].z = mvp[2].w - mvp[2].y;
    planes[TOP].w = mvp[3].w - mvp[3].y;

    planes[BOTTOM].x = mvp[0].w + mvp[0].y;
    planes[BOTTOM].y = mvp[1].w + mvp[1].y;
    planes[BOTTOM].z = mvp[2].w + mvp[2].y;
    planes[BOTTOM].w = mvp[3].w + mvp[3].y;

    planes[BACK].x = mvp[0].w + mvp[0].z;
    planes[BACK].y = mvp[1].w + mvp[1].z;
    planes[BACK].z = mvp[2].w + mvp[2].z;
    planes[BACK].w = mvp[3].w + mvp[3].z;

    planes[FRONT].x = mvp[0].w - mvp[0].z;
    planes[FRONT].y = mvp[1].w - mvp[1].z;
    planes[FRONT].z = mvp[2].w - mvp[2].z;
    planes[FRONT].w = mvp[3].w - mvp[3].z;

    for (size_t i = 0; i < planes.size(); i++) {
      float length = sqrtf(planes[i].x * planes[i].x + planes[i].y * planes[i].y + planes[i].z * planes[i].z);
      planes[i] /= length;
    }
  }
}