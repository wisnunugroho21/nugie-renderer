#include "point_shadow_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  PointShadowDescSet::PointShadowDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2]) 
		: device{device}, descriptorPool{descriptorPool}
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(modelsInfo);
  }

	PointShadowDescSet::~PointShadowDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void PointShadowDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_GEOMETRY_BIT)
				.build();
	}

  void PointShadowDescSet::createDescriptorSet(VkDescriptorBufferInfo modelsInfo[2])
	{	
		this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, modelsInfo[0])
				.writeBuffer(1, modelsInfo[1])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }

	void PointShadowDescSet::recreateDescriptorSet(VkDescriptorBufferInfo modelsInfo[2]) {
		this->descriptorPool->free(this->descriptorSets);
		this->createDescriptorSet(modelsInfo);
	}
}