#include "object_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

namespace NugieApp {
	ObjectModel::ObjectModel(NugieVulkan::Device* device) : device{device} {
		this->createObjectBuffers();
		this->createBvhBuffers();
	}

	ObjectModel::~ObjectModel() {
		if (this->bvhStagingBuffer != nullptr) delete this->bvhStagingBuffer;
		if (this->bvhBuffer != nullptr) delete this->bvhBuffer;

		if (this->objectStagingBuffer != nullptr) delete this->objectStagingBuffer;
		if (this->objectBuffer != nullptr) delete this->objectBuffer;
	}

	void ObjectModel::createObjectBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(Object));

		this->objectStagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->objectBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void ObjectModel::createBvhBuffers() {
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

	void ObjectModel::updateObject(NugieVulkan::CommandBuffer* commandBuffer, std::vector<Object> objects) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(Object)) * static_cast<VkDeviceSize>(objects.size());

		this->objectStagingBuffer->map();
		this->objectStagingBuffer->writeToBuffer((void *) objects.data(), bufferSize);
		
		this->objectBuffer->copyFromAnotherBuffer(commandBuffer, this->objectStagingBuffer, bufferSize);
	}

  void ObjectModel::updateBvh(NugieVulkan::CommandBuffer* commandBuffer, std::vector<BoundBox*> boundBoxes) {
		auto bvhNodes = createBvh(boundBoxes);
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(BvhNode)) * static_cast<VkDeviceSize>(bvhNodes.size());

		this->bvhStagingBuffer->map();
		this->bvhStagingBuffer->writeToBuffer((void *) bvhNodes.data(), bufferSize);
		
		this->bvhBuffer->copyFromAnotherBuffer(commandBuffer, this->bvhStagingBuffer, bufferSize);
	}
} // namespace NugieApp

