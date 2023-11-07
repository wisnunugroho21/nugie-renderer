#include "triangle_light_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	TriangleLightModel::TriangleLightModel(NugieVulkan::Device* device) : device{device} {
		this->createLightBuffers();
		this->createBvhBuffers();
	}

	TriangleLightModel::~TriangleLightModel() {
		if (this->bvhStagingBuffer != nullptr) delete this->bvhStagingBuffer;
		if (this->bvhBuffer != nullptr) delete this->bvhBuffer;

		if (this->triangleLightStagingBuffer != nullptr) delete this->triangleLightStagingBuffer;
		if (this->triangleLightBuffer != nullptr) delete this->triangleLightBuffer;
	}

	void TriangleLightModel::createLightBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(TriangleLight));

		this->triangleLightStagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->triangleLightBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void TriangleLightModel::createBvhBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(BvhNode));

		this->bvhStagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->bvhBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void TriangleLightModel::updateTriangleLight(NugieVulkan::CommandBuffer* commandBuffer, std::vector<TriangleLight> objects) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(TriangleLight)) * static_cast<VkDeviceSize>(objects.size());

		this->triangleLightStagingBuffer->map();
		this->triangleLightStagingBuffer->writeToBuffer((void *) objects.data(), bufferSize);
		
		this->triangleLightBuffer->copyFromAnotherBuffer(commandBuffer, this->triangleLightStagingBuffer, bufferSize);
	}

  void TriangleLightModel::updateBvh(NugieVulkan::CommandBuffer* commandBuffer, std::vector<BoundBox*> boundBoxes) {
		auto bvhNodes = createBvh(boundBoxes);
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(BvhNode)) * static_cast<VkDeviceSize>(bvhNodes.size());

		this->bvhStagingBuffer->map();
		this->bvhStagingBuffer->writeToBuffer((void *) bvhNodes.data(), bufferSize);
		
		this->bvhBuffer->copyFromAnotherBuffer(commandBuffer, this->bvhStagingBuffer, bufferSize);
	}

	void TriangleLightModel::updateBvh(NugieVulkan::CommandBuffer* commandBuffer, std::vector<TriangleLight> lights) {
		std::vector<BoundBox*> boundBoxes;

		for (int i = 0; i < lights.size(); i++) {
			boundBoxes.push_back(new TriangleLightBoundBox{ i + 1, &lights[i] });
		}

		auto bvhNodes = createBvh(boundBoxes);
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(BvhNode)) * static_cast<VkDeviceSize>(bvhNodes.size());

		this->bvhStagingBuffer->map();
		this->bvhStagingBuffer->writeToBuffer((void *) bvhNodes.data(), bufferSize);
		
		this->bvhBuffer->copyFromAnotherBuffer(commandBuffer, this->bvhStagingBuffer, bufferSize);
	}
    
} // namespace nugi

