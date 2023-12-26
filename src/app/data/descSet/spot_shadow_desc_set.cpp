#include "spot_shadow_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  SpotShadowDescSet::SpotShadowDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2], uint32_t imageCount) 
		: device{device}, descriptorPool{descriptorPool}
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(modelsInfo, imageCount);
  }

	SpotShadowDescSet::~SpotShadowDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void SpotShadowDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.build();
	}

  void SpotShadowDescSet::createDescriptorSet(VkDescriptorBufferInfo modelsInfo[2], uint32_t imageCount)  
	{
		this->descriptorSets.clear();
		for (int i = 0; i < imageCount; i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, modelsInfo[0])
				.writeBuffer(1, modelsInfo[1])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
	}

	void SpotShadowDescSet::overwrite(VkDescriptorBufferInfo modelsInfo[2]) {
		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, modelsInfo[0])
				.writeBuffer(1, modelsInfo[1])
				.overwrite(&this->descriptorSets[i]);
		}
	}
}